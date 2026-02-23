declare module 'puppeteer-extra' {
  import { Browser, LaunchOptions } from 'puppeteer';
  interface PuppeteerExtra {
    use(plugin: any): this;
    launch(options?: LaunchOptions): Promise<Browser>;
  }
  const puppeteerExtra: PuppeteerExtra;
  export default puppeteerExtra;
}

declare module 'puppeteer-extra-plugin-stealth' {
  function StealthPlugin(): any;
  export default StealthPlugin;
}
