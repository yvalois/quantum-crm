export class ConfigurationError extends Error {
  public constructor(serviceName: string, invalidKeys: readonly string[]) {
    super(`Invalid configuration for ${serviceName}: ${invalidKeys.join(", ")}`);
    this.name = "ConfigurationError";
  }
}
