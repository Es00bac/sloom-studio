#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'docs/user-manual-bilingual');
const outputRoot = path.join(root, 'docs/release/website/sloom-studio/manual');
const sitemapPath = path.join(root, 'docs/release/website/sloom-studio/sitemap.xml');
const sourceVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const verifiedDate = 'August 27, 2026';
const publicationDate = '2026-08-28';
const markdownBinary = process.env.MARKDOWN_BIN || 'markdown';

const languages = {
  en: {
    htmlLang: 'en',
    label: 'English',
    manual: 'Sloom Studio user manual',
    contents: 'Manual chapters',
    baseline: `Verified against source ${sourceVersion} on ${verifiedDate}.`,
    overview: 'Documentation overview',
    previous: 'Previous',
    next: 'Next',
    counterpart: '日本語',
  },
  ja: {
    htmlLang: 'ja',
    label: '日本語',
    manual: 'Sloom Studio ユーザーマニュアル',
    contents: 'マニュアルの章',
    baseline: `2026年8月27日にソース ${sourceVersion} に対して検証済みです。`,
    overview: 'ドキュメント概要',
    previous: '前へ',
    next: '次へ',
    counterpart: 'English',
  },
};

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const stripTags = (value) => value.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();

function slugify(value, fallback) {
  const slug = stripTags(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function titleFromMarkdown(markdown, filename) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || filename.replace(/\.md$/, '');
}

function renderMarkdown(sourcePath) {
  return execFileSync(markdownBinary, [sourcePath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function sourceSha256(sourcePath) {
  return createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
}

function enrichBody(rawHtml) {
  const used = new Map();
  let headingIndex = 0;
  return rawHtml
    .replace(/href="\.\.\/\.\.\/userguide\/14-provider-packs-model-cards\.md(?:#[^"]*)?"/g, 'href="02-settings.html"')
    .replace(/href="\.\.\/\.\.\/userguide\/12-troubleshooting-and-recovery\.md(?:#[^"]*)?"/g, 'href="02-settings.html"')
    .replace(/href="\.\.\/\.\.\/userguide\/13-accessibility-collaboration-and-automation\.md(?:#[^"]*)?"/g, 'href="09-shortcuts.html"')
    .replace(/href="([^"]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"')
    .replace(/<h([1-3])>([\s\S]*?)<\/h\1>/g, (_whole, level, content) => {
      headingIndex += 1;
      const base = slugify(content, `section-${headingIndex}`);
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;
      return `<h${level} id="${id}">${content}<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`;
    });
}

function brand(relativePrefix) {
  return `<a class="brand" href="${relativePrefix}index.html" aria-label="Sloom Studio home">
    <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M18 12h18a14 14 0 0 1 0 28H18a14 14 0 0 1 0-28Z" stroke="#29d9ff" stroke-width="7" transform="rotate(45 32 32)"/><path d="M18 24h18a14 14 0 0 1 0 28H18a14 14 0 0 1 0-28Z" stroke="#ff3fb4" stroke-width="7" transform="rotate(-45 32 32)"/></svg></span>
    Sloom Studio
  </a>`;
}

function pageTemplate({ lang, filename, title, body, sourceHash, chapters, chapterIndex }) {
  const copy = languages[lang];
  const otherLang = lang === 'en' ? 'ja' : 'en';
  const previous = chapters[chapterIndex - 1];
  const next = chapters[chapterIndex + 1];
  const chapterLinks = chapters.map((chapter, index) => (
    `<a class="manual-chapter-link${index === chapterIndex ? ' active' : ''}" href="${chapter.outputName}"${index === chapterIndex ? ' aria-current="page"' : ''}><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(chapter.title)}</a>`
  )).join('\n');
  const pageNav = [
    previous ? `<a class="manual-page-link previous" href="${previous.outputName}"><span>${copy.previous}</span><strong>${escapeHtml(previous.title)}</strong></a>` : '<span></span>',
    next ? `<a class="manual-page-link next" href="${next.outputName}"><span>${copy.next}</span><strong>${escapeHtml(next.title)}</strong></a>` : '<span></span>',
  ].join('\n');
  const canonical = `https://sloom.studio/manual/${lang}/${filename.replace(/\.md$/, '.html')}`;
  const alternate = `https://sloom.studio/manual/${otherLang}/${filename.replace(/\.md$/, '.html')}`;

  return `<!doctype html>
<html lang="${copy.htmlLang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — ${copy.manual}</title>
  <meta name="description" content="${escapeHtml(title)} — ${copy.baseline}" />
  <meta name="theme-color" content="#04070d" />
  <link rel="canonical" href="${canonical}" />
  <link rel="alternate" hreflang="${lang}" href="${canonical}" />
  <link rel="alternate" hreflang="${otherLang}" href="${alternate}" />
  <link rel="alternate" hreflang="x-default" href="https://sloom.studio/manual/en/${filename.replace(/\.md$/, '.html')}" />
  <link rel="icon" type="image/png" href="../../assets/graphics/icon-512.png" />
  <link rel="stylesheet" href="../../assets/site.css" />
  <link rel="stylesheet" href="../manual.css" />
</head>
<body data-docs-source-version="${sourceVersion}" data-manual-source-sha256="${sourceHash}">
<header class="site-header"><nav class="nav-inner wrap" aria-label="Primary navigation">
  ${brand('../../')}
  <div class="nav-links" id="nav-links"><a href="../../index.html">Home</a><a href="../../docs.html" aria-current="page">Docs</a><a href="../../examples.html">Examples</a><a href="../../changelog.html">Changelog</a><a href="../../privacy.html">Privacy</a><a href="../${otherLang}/${filename.replace(/\.md$/, '.html')}" hreflang="${otherLang}">${copy.counterpart}</a></div>
  <button class="nav-hamburger" aria-label="Toggle navigation" onclick="document.getElementById('nav-links').classList.toggle('open')"><span></span><span></span><span></span></button>
</nav></header>
<main class="manual-shell wrap">
  <aside class="manual-sidebar" aria-label="${copy.contents}">
    <a class="manual-overview-link" href="../../docs.html">← ${copy.overview}</a>
    <p class="manual-kicker">${copy.manual}</p>
    <nav>${chapterLinks}</nav>
  </aside>
  <article class="manual-article">
    <div class="manual-baseline"><strong>${sourceVersion}</strong><span>${copy.baseline}</span><code>source SHA-256: ${sourceHash}</code></div>
    ${body}
    <nav class="manual-page-nav" aria-label="Chapter navigation">${pageNav}</nav>
  </article>
</main>
<footer class="site-footer"><div class="wrap footer-inner">
  ${brand('../../')}
  <nav class="footer-links" aria-label="Footer navigation"><a href="../../index.html">Home</a><a href="../../docs.html">Docs</a><a href="../../changelog.html">Changelog</a><a href="../../privacy.html">Privacy</a><a href="mailto:support@sloom.studio">support@sloom.studio</a></nav>
  <a class="elevenlabs-grants-badge" href="https://elevenlabs.io/startup-grants" rel="noopener noreferrer" aria-label="Sloom Software is an ElevenLabs Grants recipient"><img src="/assets/graphics/elevenlabs-grants.webp" alt="ElevenLabs Grants" width="2324" height="312" loading="lazy" /></a>
  <span>&copy; 2026 Sloom Software</span>
</div></footer>
</body>
</html>
`;
}

let pageCount = 0;
const chapterNamesByLanguage = {};
for (const lang of Object.keys(languages)) {
  const langSourceRoot = path.join(sourceRoot, lang);
  const langOutputRoot = path.join(outputRoot, lang);
  mkdirSync(langOutputRoot, { recursive: true });
  const chapters = readdirSync(langSourceRoot)
    .filter((filename) => /^\d{2}-.*\.md$/.test(filename))
    .sort()
    .map((filename) => {
      const markdown = readFileSync(path.join(langSourceRoot, filename), 'utf8');
      return {
        filename,
        outputName: filename.replace(/\.md$/, '.html'),
        title: titleFromMarkdown(markdown, filename),
        sourceHash: sourceSha256(path.join(langSourceRoot, filename)),
      };
    });
  chapterNamesByLanguage[lang] = chapters.map((chapter) => chapter.filename);

  chapters.forEach((chapter, chapterIndex) => {
    const sourcePath = path.join(langSourceRoot, chapter.filename);
    const body = enrichBody(renderMarkdown(sourcePath));
    const html = pageTemplate({
      lang,
      filename: chapter.filename,
      title: chapter.title,
      body,
      sourceHash: chapter.sourceHash,
      chapters,
      chapterIndex,
    });
    writeFileSync(path.join(langOutputRoot, chapter.outputName), html);
    pageCount += 1;
  });
}

if (JSON.stringify(chapterNamesByLanguage.en) !== JSON.stringify(chapterNamesByLanguage.ja)) {
  throw new Error('English and Japanese manual chapter filenames must match before sitemap generation.');
}
const sitemapStart = '  <!-- BEGIN GENERATED MANUAL URLS -->';
const sitemapEnd = '  <!-- END GENERATED MANUAL URLS -->';
const sitemapEntries = chapterNamesByLanguage.en.flatMap((filename) => {
  const outputName = filename.replace(/\.md$/, '.html');
  const alternates = `    <lastmod>${publicationDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.65</priority>\n    <xhtml:link rel="alternate" hreflang="en" href="https://sloom.studio/manual/en/${outputName}" />\n    <xhtml:link rel="alternate" hreflang="ja" href="https://sloom.studio/manual/ja/${outputName}" />\n    <xhtml:link rel="alternate" hreflang="x-default" href="https://sloom.studio/manual/en/${outputName}" />`;
  return [
    `  <url>\n    <loc>https://sloom.studio/manual/en/${outputName}</loc>\n${alternates}\n  </url>`,
    `  <url>\n    <loc>https://sloom.studio/manual/ja/${outputName}</loc>\n${alternates}\n  </url>`,
  ];
}).join('\n');
const generatedSitemapBlock = `${sitemapStart}\n${sitemapEntries}\n${sitemapEnd}`;
const currentSitemap = readFileSync(sitemapPath, 'utf8');
const nextSitemap = currentSitemap.includes(sitemapStart) && currentSitemap.includes(sitemapEnd)
  ? currentSitemap.replace(new RegExp(`${sitemapStart}[\\s\\S]*?${sitemapEnd}`), generatedSitemapBlock)
  : currentSitemap.replace('</urlset>', `${generatedSitemapBlock}\n</urlset>`);
writeFileSync(sitemapPath, nextSitemap);

console.log(`Generated ${pageCount} substantive public manual pages and ${chapterNamesByLanguage.en.length * 2} sitemap entries from source ${sourceVersion}.`);
