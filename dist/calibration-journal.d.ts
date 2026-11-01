type Entry = {
    type: "begin" | "result";
    slot: string;
    requestHash: string;
    at: string;
    data?: any;
    status?: number;
    source?: string;
};
export declare class CalibrationJournal {
    readonly file: string;
    readonly maximumAttempts: number;
    private entries;
    private fd;
    constructor(file: string, maximumAttempts: number);
    private record;
    get attempts(): number;
    get uncertain(): string[];
    get results(): Entry[];
    close(): void;
    acknowledgeUncertain(slot: string): void;
    static requestHash(body: string): string;
    seed(slot: string, body: string, data: any): void;
    request(slot: string, body: string, call: () => Promise<Response>, secret: string): Promise<Response>;
}
export {};
//# sourceMappingURL=calibration-journal.d.ts.map