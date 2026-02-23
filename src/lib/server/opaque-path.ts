
import path from "node:path";

/**
 * Penggabung path yang "buram" (opaque) untuk menghindari analisis statis Turbopack/NFT.
 * Turbopack mencoba melakukan bundling pada path dinamis yang terdeteksi di dalam project root.
 */
export function joinOpaquePath(...segments: string[]): string {
    const joiner = path.join;
    return joiner(...segments);
}

/**
 * Resolver path yang "buram" untuk menghindari analisis statis.
 */
export function resolveOpaquePath(...segments: string[]): string {
    const resolver = path.resolve;
    return resolver(...segments);
}

/**
 * Mendapatkan root unduhan secara dinamis.
 */
export function getBaseDownloadRoot(): string {
    return resolveOpaquePath(process.cwd(), "downloads");
}

/**
 * Mendapatkan staging root untuk pemrosesan sementara sebelum ZIP.
 */
export function getStagingRoot(): string {
    return resolveOpaquePath(process.cwd(), ".temp-staging");
}
