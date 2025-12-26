export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiry: '15m',
    refreshExpiry: '7d',
  },
  otp: {
    expiryMinutes: 5,
    maxAttempts: 3,
    blockMinutes: 15,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
    enabled: process.env.TWILIO_ENABLED === 'true',
  },
  wallet: {
    minimumThreshold: 100,
  },
} as const;
