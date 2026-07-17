const CARD_CLASS_TOKEN = /(^|[\s_-])(card|post|result|feed-item|content-item|stream-item|tweet)([\s_-]|$)/i;
const CARD_TEST_ID = /(^|[-_])(card|post|result|feed-?item|content-?item|tweet)([-_]|$)/i;

export const SCANNER_SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'SVG', 'CANVAS',
  'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON',
  'META', 'LINK', 'TITLE', 'HEAD',
]);

const SCANNER_SKIP_SELECTOR = [
  ...Array.from(SCANNER_SKIP_TAGS, (tag) => tag.toLowerCase()),
  '[contenteditable="true"]',
].join(',');

export function isInsideSkippedContent(element: Element): boolean {
  return Boolean(element.closest(SCANNER_SKIP_SELECTOR));
}

export function isHideTargetElement(element: Element): boolean {
  const tag = element.tagName;
  if (tag === 'ARTICLE' || tag === 'LI') return true;

  const role = element.getAttribute('role');
  if (role === 'article' || role === 'listitem') return true;

  if (tag.includes('-') && (tag.endsWith('-RENDERER') || tag.endsWith('-CARD'))) return true;

  if (tag === 'DIV') {
    const className = typeof element.className === 'string' ? element.className : '';
    if (CARD_CLASS_TOKEN.test(className)) return true;
    const testId = element.getAttribute('data-testid');
    if (testId && CARD_TEST_ID.test(testId)) return true;
  }

  return false;
}

export function findHideTarget(start: Element | null, maxDepth = 14): Element | null {
  let element = start;
  let depth = 0;
  while (element && element !== document.body && element !== document.documentElement && depth < maxDepth) {
    if (isHideTargetElement(element)) return element;
    element = element.parentElement;
    depth += 1;
  }
  return null;
}

export function collectBoundedText(root: Element, maxLength: number): string | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || isInsideSkippedContent(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts: string[] = [];
  let length = 0;
  let current = walker.nextNode();
  while (current) {
    const value = (current as Text).data;
    length += value.length + 1;
    if (length > maxLength) return null;
    parts.push(value);
    current = walker.nextNode();
  }
  return parts.join(' ');
}
