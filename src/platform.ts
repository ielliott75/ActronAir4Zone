import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { ActronAirAccessory } from './platformAccessory.js';
import { ActronAirZoneAccessory } from './zoneAccessory.js';

export interface Zone {
  name: string;
  index: number;
  enabled: boolean;
  minTemp: number;
  maxTemp: number;
  useSeasonalRanges: boolean;
}

export interface TemperatureRanges {
  summer: {
    min: number;
    max: number;
  };
  winter: {
    min: number;
    max: number;
  };
}

export interface AccessoryConfig {
  name: string;
  ip: string;
  mac: string;
  device_token: string;
  user_token: string;
  temp_key: string;
  seasonalMode?: boolean;
  currentSeason?: 'summer' | 'winter';
  temperatureRanges?: TemperatureRanges;
  zones?: Zone[];
  pollingInterval?: number;
  debug?: boolean;
}

export class ActronAirPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const accessories = this.config.accessories as AccessoryConfig[] || [];

    // Validate and set defaults for temperature ranges
    accessories.forEach((accessoryConfig) => {
      // Set defaults for seasonal mode
      if (accessoryConfig.seasonalMode === undefined) {
        accessoryConfig.seasonalMode = true;
      }

      if (accessoryConfig.currentSeason === undefined) {
        accessoryConfig.currentSeason = 'summer';
      }

      // Set default temperature ranges if not provided
      if (!accessoryConfig.temperatureRanges) {
        accessoryConfig.temperatureRanges = {
          summer: { min: 18, max: 26 },
          winter: { min: 16, max: 24 },
        };
      }

      // Set default polling interval
      if (!accessoryConfig.pollingInterval) {
        accessoryConfig.pollingInterval = 60;
      }

      // Validate zones configuration (max 4 zones)
      if (accessoryConfig.zones) {
        if (accessoryConfig.zones.length > 4) {
          this.log.warn(`Accessory ${accessoryConfig.name} has more than 4 zones configured. Only the first 4 will be used.`);
          accessoryConfig.zones = accessoryConfig.zones.slice(0, 4);
        }

        // Set defaults for each zone
        accessoryConfig.zones.forEach((zone) => {
          if (zone.enabled === undefined) {
            zone.enabled = true;
          }
          if (zone.useSeasonalRanges === undefined) {
            zone.useSeasonalRanges = true;
          }
          if (zone.minTemp === undefined) {
            zone.minTemp = 16;
          }
          if (zone.maxTemp === undefined) {
            zone.maxTemp = 30;
          }
        });
      }
    });

    // Register main AC accessories
    for (const accessoryConfig of accessories) {
      const uuid = this.api.hap.uuid.generate(accessoryConfig.mac);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        existingAccessory.context.device = accessoryConfig;
        this.api.updatePlatformAccessories([existingAccessory]);
        new ActronAirAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', accessoryConfig.name);
        const accessory = new this.api.platformAccessory(accessoryConfig.name, uuid);
        accessory.context.device = accessoryConfig;
        new ActronAirAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // Register zone accessories
      if (accessoryConfig.zones && accessoryConfig.zones.length > 0) {
        for (const zone of accessoryConfig.zones) {
          if (!zone.enabled) {
            continue;
          }

          const zoneUuid = this.api.hap.uuid.generate(`${accessoryConfig.mac}-zone-${zone.index}`);
          const existingZoneAccessory = this.accessories.find(accessory => accessory.UUID === zoneUuid);

          if (existingZoneAccessory) {
            this.log.info('Restoring existing zone from cache:', existingZoneAccessory.displayName);
            existingZoneAccessory.context.device = accessoryConfig;
            existingZoneAccessory.context.zone = zone;
            this.api.updatePlatformAccessories([existingZoneAccessory]);
            new ActronAirZoneAccessory(this, existingZoneAccessory);
          } else {
            this.log.info('Adding new zone:', `${accessoryConfig.name} - ${zone.name}`);
            const zoneAccessory = new this.api.platformAccessory(
              `${accessoryConfig.name} - ${zone.name}`, 
              zoneUuid,
            );
            zoneAccessory.context.device = accessoryConfig;
            zoneAccessory.context.zone = zone;
            new ActronAirZoneAccessory(this, zoneAccessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [zoneAccessory]);
          }
        }
      }
    }

    // Remove accessories that are no longer configured
    const configuredUuids = new Set<string>();
    for (const accessoryConfig of accessories) {
      configuredUuids.add(this.api.hap.uuid.generate(accessoryConfig.mac));
      if (accessoryConfig.zones) {
        for (const zone of accessoryConfig.zones) {
          if (zone.enabled) {
            configuredUuids.add(this.api.hap.uuid.generate(`${accessoryConfig.mac}-zone-${zone.index}`));
          }
        }
      }
    }

    const accessoriesToRemove = this.accessories.filter(
      accessory => !configuredUuids.has(accessory.UUID),
    );

    if (accessoriesToRemove.length > 0) {
      this.log.info('Removing', accessoriesToRemove.length, 'cached accessories');
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
    }
  }

  /**
   * Get the effective temperature range for an accessory based on seasonal settings
   */
  getTemperatureRange(config: AccessoryConfig): { min: number; max: number } {
    if (config.seasonalMode && config.temperatureRanges && config.currentSeason) {
      const range = config.temperatureRanges[config.currentSeason];
      return {
        min: range.min,
        max: range.max,
      };
    }
    // Default range if seasonal mode is off
    return { min: 16, max: 30 };
  }

  /**
   * Get the effective temperature range for a zone
   */
  getZoneTemperatureRange(config: AccessoryConfig, zone: Zone): { min: number; max: number } {
    if (zone.useSeasonalRanges) {
      return this.getTemperatureRange(config);
    }
    return {
      min: zone.minTemp,
      max: zone.maxTemp,
    };
  }
}