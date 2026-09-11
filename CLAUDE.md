# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**homebridge-actronair4zone** is a Homebridge dynamic platform plugin that provides HomeKit integration for ActronAir air conditioning units with 4-zone support. It enables users to control their AC unit and individual zones through Apple HomeKit, with support for seasonal temperature ranges and configurable polling intervals.

## Common Commands

### Build and Compilation
- **Build the project**: `npm run build`
  - Compiles TypeScript from `src/` to JavaScript in `dist/`
  - Required before testing or running the plugin
  - Cleans up the `dist/` directory before rebuilding

### Linting
- **Run ESLint**: `npm run lint`
  - Enforces strict TypeScript and JavaScript linting rules
  - Uses strict mode with zero warnings allowed (`--max-warnings=0`)
  - Includes rules for formatting (quotes, indentation, semicolons), style (arrow callbacks, line length), and best practices (strict equality, consistent naming)

### Development and Testing
- **Watch mode with auto-restart**: `npm run watch`
  - Compiles TypeScript automatically on file changes
  - Automatically links the plugin and restarts Homebridge
  - Requires the plugin to be configured in `./test/hbConfig/config.json`
  - Loads configuration from the default Homebridge storage directory (`~/.homebridge`)
  - Useful for rapid iteration during development

- **Link plugin locally**: `npm link`
  - Required to make the plugin discoverable by Homebridge in development
  - Usually run automatically by `npm run watch`

- **Run Homebridge with plugin**: `homebridge -D` (after running `npm link`)
  - Launches Homebridge with debug logging enabled
  - Loads the linked plugin from the current development directory

## High-Level Architecture

### Core Components

**Platform (`src/platform.ts`)**
- Main entry point that implements Homebridge's `DynamicPlatformPlugin` interface
- Responsible for device discovery and accessory registration
- Manages both the main AC unit accessory and individual zone accessories (up to 4 zones)
- Handles caching of existing accessories and cleanup of unconfigured ones
- Provides helper methods for temperature range calculation based on seasonal settings

**Main Accessory (`src/platformAccessory.ts`)**
- Controls the main AC unit through HomeKit's Thermostat service
- Exposes characteristics: Current/Target Heating Cooling State, Current/Target Temperature, Temperature Display Units
- Polls the ActronAir cloud API at configurable intervals (default: 60 seconds) to sync state
- Maps HomeKit heating/cooling modes (OFF, HEAT, COOL, AUTO) to ActronAir API modes
- Uses axios to communicate with the ActronAir REST API

**Zone Accessory (`src/zoneAccessory.ts`)**
- Controls individual zones (up to 4 per AC unit)
- Similar structure to the main accessory but zone-specific
- Each zone is registered as a separate HomeKit accessory with its own thermostat service
- Supports per-zone temperature ranges that can use seasonal settings or fixed ranges
- Queries and controls zone state through the main AC unit's API endpoint

### Data Flow

1. **Configuration**: User provides AC unit details and zone configuration in Homebridge `config.json` (validated by `config.schema.json`)
2. **Initialization**: Platform discovers devices and registers accessories (main AC + enabled zones)
3. **Polling**: Each accessory polls the ActronAir API periodically to fetch current state
4. **HomeKit Updates**: Status changes update HomeKit characteristics, triggering HomeKit UI updates
5. **Control**: User commands from HomeKit trigger API calls to update the AC unit state

### Key Interfaces

- **`AccessoryConfig`**: Configuration for each AC unit (name, IP, MAC, tokens, temperature ranges, zones)
- **`Zone`**: Definition of a zone with name, index, temperature ranges, and enabled state
- **`TemperatureRanges`**: Summer and winter temperature range definitions

### Temperature Management

- **Seasonal Mode**: When enabled, applies different temperature ranges for summer and winter
- **Zone Temperature Ranges**: Zones can either use seasonal ranges or fixed custom ranges
- **Defaults**: Summer (18-26°C), Winter (16-24°C), General zone range (16-30°C)

## TypeScript and Build Configuration

- **Target**: ES2022 with Node.js module resolution
- **Module Format**: ES modules with CommonJS interoperability
- **Strict Mode**: Enabled for type safety
- **Strict Linting**: ESLint with `max-warnings=0` enforces code quality
- **Declaration Files**: Generated for type definitions

## API Integration

- **Base URL**: `https://que.actronair.com.au/rest/v0/device/{device_token}`
- **Authentication**: User access token passed as `user_access_token` query parameter
- **Main Operations**:
  - GET: Fetch current AC state and zone status
  - POST: Update AC settings (power, mode, temperature, zone settings)
- **Timeout**: 10 seconds per request
- **Error Handling**: Failed requests log errors and throw `SERVICE_COMMUNICATION_FAILURE` HAP status

## Configuration File Structure

The plugin is configured through Homebridge's UI or config.json with:
- Platform name: `ActronAir4Zone`
- Accessories array containing AC unit definitions
- Each accessory can define up to 4 zones
- Supports seasonal temperature ranges and polling interval customization
- Debug mode available for detailed logging

## Development Notes

- Uses `nodemon` for file watching with auto-compilation and Homebridge restart
- Test configuration stored in `./test/hbConfig/` with sample config.json and auth.json
- All API communication uses axios with configurable timeouts
- State management is per-accessory, with periodic polling to keep HomeKit in sync
- Zone state is derived from the main AC unit's API response
