const nextConfig = {
    turbopack: {},
    serverExternalPackages: [
        'puppeteer-extra', 'puppeteer-extra-plugin-stealth', 'puppeteer',
        'adm-zip',
        'fonteditor-core',
        'wawoff2',
    ],
    reactStrictMode: true,
    webpack: (config, { dev }) => {
        if (dev) {
            // Next may freeze watchOptions; replace it instead of mutating nested properties.
            const prev = config.watchOptions || {};
            const existing = prev.ignored;
            const ignoredRegex = /[\\/](?:\.temp-staging|downloads|\.next)[\\/]/;

            // Webpack schema only allows:
            // - RegExp
            // - string
            // - array of non-empty strings (globs)
            // It does NOT allow an array of RegExps.
            const mergedIgnored = (() => {
                // Keep this as a single RegExp to avoid Webpack schema issues in multi-compiler mode.
                if (!existing) return ignoredRegex;
                if (existing instanceof RegExp) {
                    return new RegExp(`${existing.source}|${ignoredRegex.source}`, existing.flags);
                }
                if (Array.isArray(existing)) {
                    // Some environments end up with array values that violate schema.
                    // Preserve only RegExp sources and merge them into one.
                    const regexes = existing.filter((value) => value instanceof RegExp);
                    const sources = [ignoredRegex.source, ...regexes.map((re) => re.source)];
                    return new RegExp(sources.join("|"));
                }
                return ignoredRegex;
            })();

            config.watchOptions = {
                ...prev,
                ignored: mergedIgnored,
            };
        }
        return config;
    }
};

export default nextConfig;
