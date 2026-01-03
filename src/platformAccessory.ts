import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { ActronAirPlatform, AccessoryConfig } from './platform';
import axios from 'axios';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ActronAirAccessory {
  private service: Service;
  private config: AccessoryConfig;
  private baseUrl: string;

  private state = {
    Active: false,
    CurrentTemperature: 20,
    TargetTemperature: 22,
    CurrentHeatingCoolingState: 0, // 0 = OFF, 1 = HEAT, 2 = COOL
    TargetHeatingCoolingState: 0,  // 0 = OFF, 1 = HEAT, 2 = COOL, 3 = AUTO
  };

  constructor(
    private readonly platform: ActronAirPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.config = accessory.context.device;
    this.baseUrl = `https://que.actronair.com.au/rest/v0/device/${this.config.device_token}`;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ActronAir')
      .setCharacteristic(this.platform.Characteristic.Model, 'Neo')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.config.mac);

    // Get or create the thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat) 
      || this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.config.name);

    // Get temperature range based on seasonal settings
    const tempRange = this.platform.getTemperatureRange(this.config);

    // Register handlers for the Current Heating Cooling State Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    // Register handlers for the Target Heating Cooling State Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    // Register handlers for the Current Temperature Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    // Register handlers for the Target Temperature Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: tempRange.min,
        maxValue: tempRange.max,
        minStep: 0.5,
      })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    // Register handlers for the Temperature Display Units Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet((value) => {
        if (this.config.debug) {
          this.platform.log.debug('Set Temperature Display Units ->', value);
        }
      });

    // Start periodic status updates
    this.startPolling();
  }

  /**
   * Start polling the AC unit for status updates
   */
  startPolling() {
    const interval = (this.config.pollingInterval || 60) * 1000;
    
    setInterval(() => {
      this.updateStatus();
    }, interval);

    // Initial update
    this.updateStatus();
  }

  /**
   * Update the accessory status from the AC unit
   */
  async updateStatus() {
    try {
      const response = await axios.get(this.baseUrl, {
        params: { user_access_token: this.config.user_token },
        timeout: 10000,
      });

      const data = response.data;
      const airconSettings = data.lastKnownState?.UserAirconSettings || {};

      // Update power state
      this.state.Active = airconSettings.isOn === true;

      // Update current temperature
      if (airconSettings.LiveTemp_oC !== undefined) {
        this.state.CurrentTemperature = airconSettings.LiveTemp_oC;
      }

      // Update target temperature
      if (airconSettings[this.config.temp_key] !== undefined) {
        this.state.TargetTemperature = airconSettings[this.config.temp_key];
      }

      // Update mode
      const mode = airconSettings.Mode;
      if (mode) {
        if (!this.state.Active) {
          this.state.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
          this.state.TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        } else {
          switch (mode.toLowerCase()) {
          case 'heat':
            this.state.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
            this.state.TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
            break;
          case 'cool':
            this.state.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
            this.state.TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState.COOL;
            break;
          case 'auto':
          {
            const tempDiff = this.state.TargetTemperature - this.state.CurrentTemperature;
            if (Math.abs(tempDiff) < 0.5) {
              this.state.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
            } else if (tempDiff > 0) {
              this.state.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
            } else {
              this.state.CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
            }
            this.state.TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
            break;
          }
          }
        }
      }

      // Update characteristics
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState,
        this.state.CurrentHeatingCoolingState,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetHeatingCoolingState,
        this.state.TargetHeatingCoolingState,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.state.CurrentTemperature,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetTemperature,
        this.state.TargetTemperature,
      );

      if (this.config.debug) {
        this.platform.log.debug('Status Update:', {
          active: this.state.Active,
          mode: mode,
          currentTemp: this.state.CurrentTemperature,
          targetTemp: this.state.TargetTemperature,
          currentState: this.state.CurrentHeatingCoolingState,
          targetState: this.state.TargetHeatingCoolingState,
        });
      }
    } catch (error) {
      this.platform.log.error('Failed to update status:', error);
    }
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    const currentValue = this.state.CurrentHeatingCoolingState;
    
    if (this.config.debug) {
      this.platform.log.debug('Get Current Heating Cooling State ->', currentValue);
    }

    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    const currentValue = this.state.TargetHeatingCoolingState;

    if (this.config.debug) {
      this.platform.log.debug('Get Target Heating Cooling State ->', currentValue);
    }

    return currentValue;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const targetValue = value as number;
    this.state.TargetHeatingCoolingState = targetValue;

    if (this.config.debug) {
      this.platform.log.debug('Set Target Heating Cooling State ->', targetValue);
    }

    try {
      // Get current state
      const response = await axios.get(this.baseUrl, {
        params: { user_access_token: this.config.user_token },
        timeout: 10000,
      });

      const data = response.data;
      const airconSettings = data.lastKnownState?.UserAirconSettings || {};

      // Map HomeKit state to ActronAir mode
      let mode = airconSettings.Mode || 'AUTO';
      let isOn = true;

      switch (targetValue) {
      case this.platform.Characteristic.TargetHeatingCoolingState.OFF:
        isOn = false;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
        mode = 'HEAT';
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
        mode = 'COOL';
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
        mode = 'AUTO';
        break;
      }

      // Update the AC unit
      await axios.post(
        this.baseUrl,
        {
          lastKnownState: {
            UserAirconSettings: {
              isOn: isOn,
              Mode: mode,
            },
          },
        },
        {
          params: { user_access_token: this.config.user_token },
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );

      this.state.Active = isOn;
      this.platform.log.info(`Set mode to ${mode} (${isOn ? 'ON' : 'OFF'})`);

      // Trigger immediate status update
      setTimeout(() => this.updateStatus(), 2000);
    } catch (error) {
      this.platform.log.error('Failed to set Target Heating Cooling State:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    const currentValue = this.state.CurrentTemperature;

    if (this.config.debug) {
      this.platform.log.debug('Get Current Temperature ->', currentValue);
    }

    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  async getTargetTemperature(): Promise<CharacteristicValue> {
    const currentValue = this.state.TargetTemperature;

    if (this.config.debug) {
      this.platform.log.debug('Get Target Temperature ->', currentValue);
    }

    return currentValue;
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async setTargetTemperature(value: CharacteristicValue) {
    const tempRange = this.platform.getTemperatureRange(this.config);
    
    // Clamp temperature to allowed range
    let temp = value as number;
    if (temp < tempRange.min) {
      temp = tempRange.min;
      this.platform.log.warn(
        `Temperature ${value}°C below ${this.config.currentSeason || 'default'} minimum ${tempRange.min}°C, clamping`,
      );
    }
    if (temp > tempRange.max) {
      temp = tempRange.max;
      this.platform.log.warn(
        `Temperature ${value}°C above ${this.config.currentSeason || 'default'} maximum ${tempRange.max}°C, clamping`,
      );
    }

    this.state.TargetTemperature = temp;

    if (this.config.debug) {
      this.platform.log.debug(
        `Set Target Temperature -> ${temp}°C (range: ${tempRange.min}-${tempRange.max}°C, season: ${this.config.currentSeason || 'none'})`,
      );
    }

    try {
      // Get current state
      const response = await axios.get(this.baseUrl, {
        params: { user_access_token: this.config.user_token },
        timeout: 10000,
      });

      const data = response.data;
      const airconSettings = data.lastKnownState?.UserAirconSettings || {};

      // Update the temperature using the configured temp_key
      const updateData: any = {
        lastKnownState: {
          UserAirconSettings: {},
        },
      };
      updateData.lastKnownState.UserAirconSettings[this.config.temp_key] = temp;

      await axios.post(
        this.baseUrl,
        updateData,
        {
          params: { user_access_token: this.config.user_token },
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );

      this.platform.log.info(`Set target temperature to ${temp}°C`);

      // Trigger immediate status update
      setTimeout(() => this.updateStatus(), 2000);
    } catch (error) {
      this.platform.log.error('Failed to set Target Temperature:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle season change - updates temperature range properties
   */
  updateTemperatureRangeProps() {
    const tempRange = this.platform.getTemperatureRange(this.config);
    
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: tempRange.min,
        maxValue: tempRange.max,
        minStep: 0.5,
      });

    if (this.config.debug) {
      this.platform.log.debug(
        `Updated temperature range props: ${tempRange.min}-${tempRange.max}°C (season: ${this.config.currentSeason || 'none'})`,
      );
    }
  }
}
