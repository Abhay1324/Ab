export declare const config: {
    readonly port: number;
    readonly nodeEnv: string;
    readonly jwt: {
        readonly secret: string;
        readonly refreshSecret: string;
        readonly accessExpiry: "15m";
        readonly refreshExpiry: "7d";
    };
    readonly otp: {
        readonly expiryMinutes: 5;
        readonly maxAttempts: 3;
        readonly blockMinutes: 15;
    };
    readonly wallet: {
        readonly minimumThreshold: 100;
    };
};
//# sourceMappingURL=index.d.ts.map