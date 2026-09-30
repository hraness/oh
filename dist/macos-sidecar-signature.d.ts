export declare class MacOsSidecarSignatureError extends Error {
    readonly name = "MacOsSidecarSignatureError";
    constructor();
}
export type VerifiedMacSidecar = Readonly<{
    dev: bigint;
    ino: bigint;
    size: bigint;
    mode: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
}>;
export declare function assertVerifiedMacSidecar(path: string, expected: VerifiedMacSidecar): void;
export declare function verifyMacSidecar(path: string): Promise<VerifiedMacSidecar>;
export declare function verifyMacSidecarSync(path: string): VerifiedMacSidecar;
//# sourceMappingURL=macos-sidecar-signature.d.ts.map