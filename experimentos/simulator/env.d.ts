interface __BaseEnv_SimulatorEnv {
    BANK_TOKEN: string;
    EVIDENCE: DurableObjectNamespace<import("./index").Evidence>;
}
declare namespace Cloudflare {
    interface GlobalProps {
        mainModule: typeof import("./index");
        durableNamespaces: "Evidence";
    }
    interface Env extends __BaseEnv_SimulatorEnv {
    }
}
interface SimulatorEnv extends __BaseEnv_SimulatorEnv {
}
type StringifyValues<EnvType extends Record<string, unknown>> = {
    [Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string;
};
declare namespace NodeJS {
    interface ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, "BANK_TOKEN">> {
    }
}
