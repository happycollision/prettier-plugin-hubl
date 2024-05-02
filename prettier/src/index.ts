import type { Plugin } from "prettier";
import prettierSync from "@prettier/sync";
import { parse } from "../../parser/dist/index";
import printers from "./printHubl";

const languages = [
  {
    name: "HubL",
    parsers: ["hubl"],
    extensions: [".hubl.html"],
    vscodeLanguageIds: ["html-hubl"],
  },
];

function locStart(node) {
  return node.colno;
}

function locEnd(node) {
  return node.colno;
}

let tokenMap = new Map();
let tokenIndex = 0;

const lookupDuplicateNestedToken = (match) => {
  let tokens = tokenMap.entries();
  for (let token of tokens) {
    if (token[1] === match && token[0].startsWith("npe")) {
      return token[0];
    }
  }
};

function styleToken(tokenIndex: number) {
  return `/*__STYLE_BLOCK_${tokenIndex}__*/`;
}

function styleValueToken(tokenIndex: number) {
  return `__STYLE_VALUE_${tokenIndex}__`;
}

function scriptToken(tokenIndex: number) {
  return "_" + tokenIndex;
}

function htmlToken(tokenIndex: number) {
  return `npe${tokenIndex}_`;
}

function commentToken(tokenIndex: number) {
  return `<!--${tokenIndex}-->`;
}

function genericToken(tokenIndex: number) {
  return `<!--placeholder-${tokenIndex}-->`;
}

const tokenize = (input: string) => {
  const COMMENT_REGEX = /{#.*?#}/gms;
  const HUBL_TAG_REGEX = /({%.+?%})/gs;
  const LINE_BREAK_REGEX = /[\r\n]+/gm;
  const VARIABLE_REGEX = /({{.+?}})/gs;
  const HTML_TAG_WITH_HUBL_TAG_REGEX = /<[^>]*?(?={%|{{).*?>/gms;
  const STYLE_BLOCK_WITH_HUBL_REGEX = /<style.[^>]*?(?={%|{{).*?style>/gms;
  const SCRIPT_BLOCK_WITH_HUBL_REGEX = /<script.[^>]*?(?={%|{{).*?script>/gms;
  const JSON_BLOCK_REGEX =
    /(?<={% widget_attribute.*is_json="?true"? %}|{% module_attribute.*is_json="?true"? %}).*?(?={%.*?end_module_attribute.*?%}|{%.*?end_widget_attribute.*?%})/gims;

  // Replace tags in style block
  const nestedStyleTags = input.match(STYLE_BLOCK_WITH_HUBL_REGEX);
  if (nestedStyleTags) {
    const HUBL_TAG_REGEX_WITH_LEAD = /(:\s*)?({%.+?%})/gs;
    const VARIABLE_REGEX_WITH_LEAD = /(:\s*)?({{.+?}})/gs;
    const COMMENT_REGEX_WITH_LEAD = /(:\s*)?({#.*?#})/gms;

    for (const tag of nestedStyleTags) {
      let newString = tag;
      for (const regex of [
        HUBL_TAG_REGEX_WITH_LEAD,
        VARIABLE_REGEX_WITH_LEAD,
        COMMENT_REGEX_WITH_LEAD,
      ]) {
        newString = newString.replace(regex, (all, lead, match) => {
          tokenIndex++;
          const token = lead
            ? styleValueToken(tokenIndex)
            : styleToken(tokenIndex);
          tokenMap.set(token, match);
          return (lead || "") + token;
        });
      }

      input = input.replace(tag, newString);
    }
  }

  // Replace tags in script block
  const nestedScriptTags = input.match(SCRIPT_BLOCK_WITH_HUBL_REGEX);
  if (nestedScriptTags) {
    for (const tag of nestedScriptTags) {
      let newString = tag;

      for (const regex of [HUBL_TAG_REGEX, VARIABLE_REGEX, COMMENT_REGEX]) {
        newString = newString.replace(regex, (match) => {
          tokenIndex++;
          tokenMap.set(scriptToken(tokenIndex), match);
          return scriptToken(tokenIndex);
        });
      }

      input = input.replace(tag, newString);
    }
  }

  // Replace expressions inside of HTML tags first
  const nestedHtmlTags = input.match(HTML_TAG_WITH_HUBL_TAG_REGEX);
  if (nestedHtmlTags) {
    nestedHtmlTags.forEach((tag) => {
      let newString = tag;

      newString = newString.replace(HUBL_TAG_REGEX, (match) => {
        tokenIndex++;
        tokenMap.set(htmlToken(tokenIndex), match);
        return htmlToken(tokenIndex);
      });

      newString = newString.replace(VARIABLE_REGEX, (match) => {
        // Variables are sometimes used as HTML tag names
        const token = lookupDuplicateNestedToken(match);
        if (token) {
          return token;
        }

        tokenIndex++;
        tokenMap.set(htmlToken(tokenIndex), match);
        return htmlToken(tokenIndex);
      });

      input = input.replace(tag, newString);
    });
  }

  const comments = input.match(COMMENT_REGEX);
  if (comments) {
    comments.forEach((comment) => {
      tokenIndex++;
      tokenMap.set(commentToken(tokenIndex), comment);
      input = input.replace(comment, commentToken(tokenIndex));
    });
  }

  const jsonBlocks = input.match(JSON_BLOCK_REGEX);
  if (jsonBlocks) {
    jsonBlocks.forEach((match) => {
      tokenIndex++;
      tokenMap.set(
        genericToken(tokenIndex),
        `{% json_block %}${match}{% end_json_block %}`,
      );
      input = input.replace(match, genericToken(tokenIndex));
    });
  }

  const hublTags = input.match(HUBL_TAG_REGEX);
  if (hublTags) {
    hublTags.forEach((match) => {
      tokenIndex++;
      tokenMap.set(
        genericToken(tokenIndex),
        match.replace(LINE_BREAK_REGEX, " "),
      );
      input = input.replace(match, genericToken(tokenIndex));
    });
  }

  const expressionMatches = input.match(VARIABLE_REGEX);
  if (expressionMatches) {
    expressionMatches.forEach((match) => {
      tokenIndex++;
      tokenMap.set(genericToken(tokenIndex), match);
      input = input.replace(match, genericToken(tokenIndex));
    });
  }
  tokenIndex = 0;
  return input;
};

const unTokenize = (input: string) => {
  tokenMap.forEach((value, key) => {
    input = input.replaceAll(key, value);
  });
  tokenMap.clear();

  return input;
};

const preserveFormatting = (input: string) => {
  const BEGIN_PRE_REGEX = /<pre.*?>/gms;
  const END_PRE_REGEX = /(?<!{% end_preserve %})<\/pre>/gms;

  input = input.replace(BEGIN_PRE_REGEX, (match) => {
    return `${match}{% preserve %}`;
  });
  input = input.replace(END_PRE_REGEX, (match) => {
    return `{% endpreserve %}${match}`;
  });

  return input;
};

const parsers: Plugin["parsers"] = {
  hubl: {
    astFormat: "hubl-ast",
    parse,
    locStart,
    locEnd,
    preprocess: (text) => {
      let updatedText = text.trim();
      // Swap HubL tags for placeholders
      updatedText = tokenize(updatedText);
      // Parse and format HTML
      updatedText = prettierSync.format(updatedText, { parser: "html" });
      // Find <pre> tags and add {% preserve %} wrapper
      // to tell the HubL parser to preserve formatting
      updatedText = preserveFormatting(updatedText);
      // Swap back HubL tags and return
      return unTokenize(updatedText);
    },
  },
};

const options = {};

const defaultOptions = {};

export { languages, printers, parsers, options, defaultOptions };
