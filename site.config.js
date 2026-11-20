// 站点配置。页面里的资源一律写相对地址；绝对地址（canonical、hreflang、分享卡片）只从 siteUrl 来。
// 换域名只改环境变量 SITE_URL（或下面的默认值），要以 / 结尾。

const DEFAULT_SITE_URL = 'https://poundlock.github.io/poundlock-site/';

export const config = {
  siteUrl: process.env.SITE_URL || DEFAULT_SITE_URL,
  repoUrl: 'https://github.com/poundlock/poundlock-skills',
  repoApi: 'https://api.github.com/repos/poundlock/poundlock-skills',
  langs: [
    { code: 'zh', htmlLang: 'zh-CN', path: '', label: '中文' },
    { code: 'en', htmlLang: 'en', path: 'en/', label: 'EN' },
  ],
  defaultLang: 'zh',
};
