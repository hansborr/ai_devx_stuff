export const DOLOS_TOOL = "dolos" as const;

export type DolosReportFiles = {
  readonly pairsCsv: string;
  readonly filesCsv?: string;
  readonly metadataCsv?: string;
};

export type DolosFileRange = {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
};

export type DolosPairMetrics = {
  readonly similarity: number;
  readonly totalOverlap: number;
  readonly longestFragment: number;
  readonly leftCovered?: number;
  readonly rightCovered?: number;
};

export type DolosCandidatePair = {
  readonly engine: typeof DOLOS_TOOL;
  readonly engineVersion?: string;
  readonly languageMode: string;
  readonly threshold: number;
  readonly score: number;
  readonly left: DolosFileRange;
  readonly right: DolosFileRange;
  readonly metrics: DolosPairMetrics;
};

export type DolosReportMetadata = {
  readonly engine: typeof DOLOS_TOOL;
  readonly engineVersion?: string;
  readonly languageMode: string;
  readonly threshold: number;
};

type DolosParserCaps = {
  readonly maxCandidatePairs?: number;
  readonly maxReportedPairs?: number;
};

export type DolosParseTruncation = {
  readonly parsedPairs: number;
  readonly candidatePairsTruncated: boolean;
  readonly reportedPairsTruncated: boolean;
  readonly missingFileRanges: readonly string[];
};

export type DolosParseResult = {
  readonly metadata: DolosReportMetadata;
  readonly candidates: readonly DolosCandidatePair[];
  readonly caps: DolosParserCaps;
  readonly truncation: DolosParseTruncation;
};

export type ParseDolosReportOptions = {
  readonly engineVersion?: string;
  readonly languageMode?: string;
  readonly threshold?: number;
  readonly maxCandidatePairs?: number;
  readonly maxReportedPairs?: number;
  readonly fileLineCounts?: ReadonlyMap<string, number>;
};
