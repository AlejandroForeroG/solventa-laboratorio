interface __BaseEnv_IdentityEnv {
    CONSENT_DB: Hyperdrive;
    BANK_MODE: "local-memory";
    BANK_TOKEN: string;
}
declare namespace Cloudflare {
    interface GlobalProps {
        mainModule: typeof import("./index");
    }
    interface Env extends __BaseEnv_IdentityEnv {
    }
}
interface IdentityEnv extends __BaseEnv_IdentityEnv {
}
type StringifyValues<EnvType extends Record<string, unknown>> = {
    [Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string;
};
declare namespace NodeJS {
    interface ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, "BANK_MODE" | "BANK_TOKEN">> {
    }
}
