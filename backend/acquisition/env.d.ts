interface __BaseEnv_AcquisitionEnv {
    RISK_DB: Hyperdrive;
    BANK_MODE: "local-memory";
    BANK_TOKEN: string;
    IDENTITY: Fetcher;
    SIMULATOR: Fetcher;
}
declare namespace Cloudflare {
    interface GlobalProps {
        mainModule: typeof import("./index");
    }
    interface Env extends __BaseEnv_AcquisitionEnv {
    }
}
interface AcquisitionEnv extends __BaseEnv_AcquisitionEnv {
}
type StringifyValues<EnvType extends Record<string, unknown>> = {
    [Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string;
};
declare namespace NodeJS {
    interface ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, "BANK_MODE" | "BANK_TOKEN">> {
    }
}
