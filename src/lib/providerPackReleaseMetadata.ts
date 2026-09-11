/**
 * Release-owned community destinations. Provider packs may link to these pages, but they do not
 * implement an online catalog or inherit trust from them.
 */
export const PROVIDER_PACK_RELEASE_METADATA = Object.freeze({
  minimumSloomVersion: '0.9.12-w',
  forumCategoryUrl: 'https://sloom.studio/forum/t/provider-packs-model-cards',
  githubDiscussionsCategoryUrl: 'https://github.com/Es00bac/signal-loom/discussions/2',
  labels: Object.freeze([
    'Text',
    'Image',
    'Video',
    'Audio',
    'Community-tested',
    'Needs update',
    'Security advisory',
  ]),
});
