import chinese from './help-messages/zh-CN.json';
import english from './help-messages/en-US.json';
import { createTranslator, liekanMessages } from './text';

// This catalog is loaded with the help view, leaving analytics bundles smaller.
export const helpTranslator = createTranslator(
  { ...liekanMessages['zh-CN'], ...chinese },
  { ...liekanMessages['en-US'], ...english },
);
