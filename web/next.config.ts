import type { NextConfig } from "next";
import os from 'node:os';

const lanAddresses = Object.values(os.networkInterfaces())
  .flatMap((networkInterface) => networkInterface ?? [])
  .filter((networkAddress) => networkAddress.family === 'IPv4' && !networkAddress.internal)
  .map((networkAddress) => networkAddress.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: [...lanAddresses, 'localhost:3000'],
  /* keep other config options if any */
};

export default nextConfig;