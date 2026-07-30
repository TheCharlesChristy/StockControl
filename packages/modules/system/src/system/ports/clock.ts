export interface Clock {
  now(): Date;
  uptimeSeconds(): number;
}
