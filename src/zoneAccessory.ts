import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { ActronAirPlatform, Zone, AccessoryConfig } from './platform';
import axios from 'axios';

export class ActronAirZoneAccessory {
  private service: Service;
  private config: AccessoryConfig;
  private zone: Zone;
  private baseUrl: string;

  private state = {
    Active: false,
    CurrentTemperature: 20,
    TargetTemperature: 22,
    CurrentHeatingCoolingState: 0,
    TargetHeatingCoolingState: 0,
  };

  constructor(
    private readonly platform: ActronAirPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.config = accessory.context.device;
    this.zone = accessory.context.zone;
    this.baseUrl = `https://que.actronair.com.au/rest/v0/device/${this.config.device_token}`;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ActronAir')
      .setCharacteristic(this.platform.Characteristic.Model, 'Zone Control')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `${this.config.mac}-Z${this.zone.index}`);

    // Get or create the thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat) 
      || this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.zone.name);

    // Get temperature range for this zone
    const tempRange = this.platform.getZoneTemperatureRange(this.config, this.zone);

    // Set up characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: tempRange.min,
        maxValue: tempRange.max,
        minStep: 0.5,
      })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet((value) => {
        if (this.config.debug) {
          this.platform.log.debug(`Zone ${this.zone.name}: Temperature Display Units set to`, value);
        }
      });

    // Start periodic status updates
    this.startPolling();
  }

  startPolling() {
    const interval = (this.config.pollingInterval || 60) * 1000;
    setInterval(() => {
      this.updateStatus();
    }, interval);

    // Initial update
    this.updateStatus();
  }

  async updateStatus() {
    try {
      const response = await axios.get(this.baseUrl, {
        params: { user_access_token: this.config.user_token },
        timeout: 10000,
      });

      const data = response.data;
      const zones = data.lastKnownState?.UserAirconSettings?.EnabledZones || [];
      
      if (this.zone.index < zones.length) {
        const zoneData = zones[this.zone.index];
        
        // Update zone state
        this.state.Active = zoneData.State === 'on';
        this.state.CurrentTemperature = zoneData.LiveTemp_oC || 20;
        this.state.TargetTemperature = zoneData[this.config.temp_key] || 22;

        // Update characteristics
        this.service.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature,
          this.state.CurrentTemperature,
        );

        if (this.config.debug) {
          this.platform.log.debug(
            `Zone ${this.zone.name}: Updated - Active: ${this.state.Active}, ` +
            `Current: ${this.state.CurrentTemperature}°C, Target: ${this.state.TargetTemperature}°C`,
          );
        }
      }
    } catch (error) {
      this.platform.log.error(`Zone ${this.zone.name}: Failed to update status:`, error);
    }
  }

  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    return this.state.CurrentHeatingCoolingState;
  }

  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    return this.state.TargetHeatingCoolingState;
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    this.state.TargetHeatingCoolingState = value as number;
    
    if (this.config.debug) {
      this.platform.log.debug(`Zone ${this.zone.name}: Set Target Heating Cooling State to`, value);
    }

    // Update zone enable/disable state
    const enabled = value !== this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    await this.setZoneEnabled(enabled);
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    return this.state.CurrentTemperature;
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    return this.state.TargetTemperature;
  }

  async setTargetTemperature(value: CharacteristicValue) {
    const tempRange = this.platform.getZoneTemperatureRange(this.config, this.zone);
    
    // Clamp temperature to zone-specific range
    let temp = value as number;
    if (temp < tempRange.min) {
      temp = tempRange.min;
      this.platform.log.warn(
        `Zone ${this.zone.name}: Temperature ${value}°C below minimum ${tempRange.min}°C, clamping`,
      );
    }
    if (temp > tempRange.max) {
      temp = tempRange.max;
      this.platform.log.warn(
        `Zone ${this.zone.name}: Temperature ${value}°C above maximum ${tempRange.max}°C, clamping`,
      );
    }

    this.state.TargetTemperature = temp;

    if (this.config.debug) {
      this.platform.log.debug(
        `Zone ${this.zone.name}: Set Target Temperature to ${temp}°C ` +
        `(range: ${tempRange.min}-${tempRange.max}°C)`,
      );
    }

    await this.updateZoneTemperature(temp);
  }

  async setZoneEnabled(enabled: boolean) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: { user_access_token: this.config.user_token },
        timeout: 10000,
      });

      const data = response.data;
      const zones = data.lastKnownState?.UserAirconSettings?.EnabledZones || [];

      if (this.zone.index < zones.length) {
        zones[this.zone.index].State = enabled ? 'on' : 'off';

        await axios.post(
          this.baseUrl,
          {
            lastKnownState: {
              UserAirconSettings: {
                EnabledZones: zones,
              },
            },
          },
          {
            params: { user_access_token: this.config.user_token },
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
          },
        );

        this.platform.log.info(`Zone ${this.zone.name}: ${enabled ? 'Enabled' : 'Disabled'}`);
      }
    } catch (error) {
      this.platform.log.error(`Zone ${this.zone.name}: Failed to set enabled state:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async updateZoneTemperature(temp: number) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: { user_access_token: this.config.user_token },
        timeout: 10000,
      });

      const data = response.data;
      const zones = data.lastKnownState?.UserAirconSettings?.EnabledZones || [];

      if (this.zone.index < zones.length) {
        zones[this.zone.index][this.config.temp_key] = temp;

        await axios.post(
          this.baseUrl,
          {
            lastKnownState: {
              UserAirconSettings: {
                EnabledZones: zones,
              },
            },
          },
          {
            params: { user_access_token: this.config.user_token },
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
          },
        );

        this.platform.log.info(`Zone ${this.zone.name}: Temperature set to ${temp}°C`);
      }
    } catch (error) {
      this.platform.log.error(`Zone ${this.zone.name}: Failed to set temperature:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
