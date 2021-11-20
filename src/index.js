import Lexer from 'lex';
import debounce from 'lodash/debounce';
import isObject from 'lodash/isObject';
import throttle from 'lodash/throttle';

import LRUCache from './lru-cache';
import { DOMReady, escapeRegExp, setUrlParams } from './utils';

const reIntValue = '(-?0|-?[1-9][0-9]*)';
const reFractionPart = '\\.[0-9]+';
const reExponentPart = '[eE][+-]?[0-9]+';
const intRegex = new RegExp(reIntValue);
const floatRegex = new RegExp(
  `${reIntValue}${reFractionPart}${reExponentPart}`
  + `|${reIntValue}${reFractionPart}|${reIntValue}${reExponentPart}`,
);
const reLineTerminators = '\\n\\r\\u2028\\u2029';
const reEscapedChar = '\\\\[\\\\"/bfnrt]';
const reEscapedUnicode = '\\\\u[0-9A-Fa-f]{4}';
const reStringChar = `[^\\\\"\\\\\\\\${reLineTerminators}]`;
const stringRegex = new RegExp(
  '\\"('
  + `${reEscapedChar}|${reEscapedUnicode}|${reStringChar}`
  + ')*\\"',
);
const nameRegex = /[_A-Za-z][_0-9A-Za-z]*(\.[_A-Za-z][_0-9A-Za-z]*)*/;
const reNotFollowedByName = '(?![_0-9A-Za-z])';
const whitespaceRegex = /[ \t\v\f\u00A0]+/;

const lexer = new Lexer(() => {
  // Silently swallow any lexer errors
});

function token(name, value) {
  return { name, value };
}

lexer.addRule(whitespaceRegex, () => { /* ignore whitespace */ });
lexer.addRule(/\./, (l) => token('DOT', l));
lexer.addRule(/,/, (l) => token('COMMA', l));
lexer.addRule(new RegExp(`or${reNotFollowedByName}`), (l) => token('OR', l));
lexer.addRule(new RegExp(`and${reNotFollowedByName}`), (l) => token('AND', l));
lexer.addRule(new RegExp(`not${reNotFollowedByName}`), (l) => token('NOT', l));
lexer.addRule(new RegExp(`in${reNotFollowedByName}`), (l) => token('IN', l));
lexer.addRule(
  new RegExp(`startswith${reNotFollowedByName}`),
  (l) => token('STARTSWITH', l),
);
lexer.addRule(
  new RegExp(`endswith${reNotFollowedByName}`),
  (l) => token('ENDSWITH', l),
);
lexer.addRule(
  new RegExp(`True${reNotFollowedByName}`),
  (l) => token('TRUE', l),
);
lexer.addRule(
  new RegExp(`False${reNotFollowedByName}`),
  (l) => token('FALSE', l),
);
lexer.addRule(
  new RegExp(`None${reNotFollowedByName}`),
  (l) => token('NONE', l),
);
lexer.addRule(nameRegex, (l) => token('NAME', l));
lexer.addRule(
  stringRegex,
  // Trim leading and trailing quotes:
  (l) => token('STRING_VALUE', l.slice(1, l.length - 1)),
);
lexer.addRule(intRegex, (l) => token('INT_VALUE', l));
lexer.addRule(floatRegex, (l) => token('FLOAT_VALUE', l));
lexer.addRule(/\(/, (l) => token('PAREN_L', l));
lexer.addRule(/\)/, (l) => token('PAREN_R', l));
lexer.addRule(/=/, (l) => token('EQUALS', l));
lexer.addRule(/!=/, (l) => token('NOT_EQUALS', l));
lexer.addRule(/>/, (l) => token('GREATER', l));
lexer.addRule(/>=/, (l) => token('GREATER_EQUAL', l));
lexer.addRule(/</, (l) => token('LESS', l));
lexer.addRule(/<=/, (l) => token('LESS_EQUAL', l));
lexer.addRule(/~/, (l) => token('CONTAINS', l));
lexer.addRule(/!~/, (l) => token('NOT_CONTAINS', l));
lexer.lexAll = function () {
  let match;
  const result = [];
  while (match = this.lex()) { // eslint-disable-line no-cond-assign
    match.start = this.index - match.value.length;
    match.end = this.index;
    result.push(match);
  }
  return result;
};

function suggestion(text, snippetBefore, snippetAfter, explanation) {
  // text is being displayed in completion box and pasted when you hit Enter.
  // snippetBefore is an optional extra text to be pasted before main text.
  // snippetAfter is an optional text to be pasted after. It may also include
  // "|" symbol to designate desired cursor position after paste.
  let suggestionText = text;
  if (typeof explanation !== 'undefined') {
    suggestionText += `<i>${explanation}</i>`;
  }

  return {
    text,
    snippetBefore: snippetBefore || '',
    snippetAfter: snippetAfter || '',
    suggestionText,
  };
}

// Main DjangoQL object
const DjangoQL = function (options) {
  let cacheSize = 100;

  this.options = options;
  this.currentModel = null;
  this.models = {};
  this.suggestionsAPIUrl = null;

  this.token = token;
  this.lexer = lexer;

  this.prefix = '';
  this.suggestions = [];
  this.selected = null;
  this.valuesCaseSensitive = false;
  this.highlightCaseSensitive = true;

  this.textarea = null;
  this.completion = null;
  this.completionUL = null;
  this.completionEnabled = false;

  // Initialization
  if (!isObject(options)) {
    this.logError('Please pass an object with initialization parameters');
    return;
  }
  this.loadIntrospections(options.introspections);
  if (typeof options.selector === 'string') {
    this.textarea = document.querySelector(options.selector);
  } else {
    this.textarea = options.selector;
  }
  if (!this.textarea) {
    this.logError(`Element not found by selector: ${options.selector}`);
    return;
  }
  if (this.textarea.tagName !== 'TEXTAREA') {
    this.logError(
      'selector must be pointing to <textarea> element, '
      + `but ${this.textarea.tagName} was found`,
    );
    return;
  }
  if (options.valuesCaseSensitive) {
    this.valuesCaseSensitive = true;
  }
  if (options.cacheSize) {
    if (parseInt(options.cacheSize, 10) !== options.cacheSize
        || options.cacheSize < 1) {
      this.logError('cacheSize must be a positive integer');
    } else {
      cacheSize = options.cacheSize;
    }
  }
  this.suggestionsCache = new LRUCache(cacheSize);
  this.debouncedLoadFieldOptions = debounce(
    this.loadFieldOptions.bind(this),
    300,
  );
  this.loading = false;

  this.enableCompletion = this.enableCompletion.bind(this);
  this.disableCompletion = this.disableCompletion.bind(this);

  // these handlers are re-used more than once in the code below,
  // so it's handy to have them already bound
  this.onCompletionMouseClick = this.onCompletionMouseClick.bind(this);
  this.onCompletionMouseDown = this.onCompletionMouseDown.bind(this);
  this.popupCompletion = this.popupCompletion.bind(this);
  this.debouncedRenderCompletion = debounce(
    this.renderCompletion.bind(this),
    50,
  );

  // Bind event handlers and initialize completion & textSize containers
  this.textarea.setAttribute('autocomplete', 'off');
  this.textarea.addEventListener('keydown', this.onKeydown.bind(this));
  this.textarea.addEventListener('blur', this.hideCompletion.bind(this));
  this.textarea.addEventListener('click', this.popupCompletion);
  if (options.autoResize) {
    this.textareaResize = this.textareaResize.bind(this);
    this.textarea.style.resize = 'none';
    this.textarea.style.overflow = 'hidden';
    this.textarea.addEventListener('input', this.textareaResize);
    this.textareaResize();
    // There could be a situation when fonts are not loaded yet at this
    // point. When fonts are finally loaded it could make textarea looking
    // weird - for example in Django 1.9+ last line won't fit. To fix this
    // we call .textareaResize() once again when window is fully loaded.
    window.addEventListener('load', this.textareaResize);
  } else {
    this.textareaResize = null;
    // Catch resize events and re-position completion box.
    // See http://stackoverflow.com/a/7055239
    this.textarea.addEventListener(
      'mouseup',
      this.renderCompletion.bind(this, true),
    );
    this.textarea.addEventListener(
      'mouseout',
      this.renderCompletion.bind(this, true),
    );
  }

  this.createCompletionElement();
};

// Backward compatibility
DjangoQL.init = function (options) {
  return new DjangoQL(options);
};

DjangoQL.DOMReady = DOMReady;

DjangoQL.prototype = {
  createCompletionElement() {
    const { options } = this;
    let syntaxHelp;

    if (!this.completion) {
      this.completion = document.createElement('div');
      this.completion.className = 'djangoql-completion';
      document.querySelector('body').appendChild(this.completion);
      this.completionUL = document.createElement('ul');
      this.completionUL.onscroll = throttle(
        this.onCompletionScroll.bind(this),
        50,
      );
      this.completion.appendChild(this.completionUL);
      if (typeof options.syntaxHelp === 'string') {
        syntaxHelp = document.createElement('p');
        syntaxHelp.className = 'syntax-help';
        syntaxHelp.innerHTML = `<a href="${options.syntaxHelp}`
          + '" target="_blank">Syntax Help</a>';
        syntaxHelp.addEventListener('mousedown', (e) => {
          // This is needed to prevent conflict with textarea.onblur event
          // handler, which tries to hide the completion box and therefore
          // makes Syntax Help link malfunctional.
          e.preventDefault();
        });
        this.completion.appendChild(syntaxHelp);
      }

      // eslint-disable-next-line no-prototype-builtins
      this.completionEnabled = options.hasOwnProperty('completionEnabled')
        ? options.completionEnabled
        : true;
    }
  },

  destroyCompletionElement() {
    if (this.completion) {
      this.completion.parentNode.removeChild(this.completion);
      this.completion = null;
      this.completionEnabled = false;
    }
  },

  enableCompletion() {
    this.completionEnabled = true;
  },

  disableCompletion() {
    this.completionEnabled = false;
    this.hideCompletion();
  },

  getJson(url, settings) {
    this.loading = true;

    const onLoadError = function () {
      this.loading = false;
      this.request = null;
      this.logError(`failed to fetch from ${url}`);
    }.bind(this);

    if (this.request) {
      this.request.abort();
    }
    this.request = new XMLHttpRequest();

    this.request.open('GET', url, true);
    this.request.onload = function () {
      this.loading = false;
      if (this.request.status === 200) {
        if (typeof settings.success === 'function') {
          settings.success(JSON.parse(this.request.responseText));
        }
      } else {
        onLoadError();
      }
      this.request = null;
    }.bind(this);
    this.request.ontimeout = onLoadError;
    this.request.onerror = onLoadError;
    /* eslint-disable max-len */
    // Workaround for IE9, see
    // https://cypressnorth.com/programming/internet-explorer-aborting-ajax-requests-fixed/
    /* eslint-enable max-len */
    this.request.onprogress = function () {};
    window.setTimeout(this.request.send.bind(this.request));
  },

  loadIntrospections(introspections) {
    const initIntrospections = function (data) {
      this.currentModel = data.current_model;
      this.models = data.models;
      this.suggestionsAPIUrl = data.suggestions_api_url;
    }.bind(this);

    if (typeof introspections === 'string') {
      // treat as URL
      this.getJson(introspections, { success: initIntrospections });
    } else if (isObject(introspections)) {
      initIntrospections(introspections);
    } else {
      this.logError(
        'introspections parameter is expected to be either URL or '
        + `object with definitions, but ${introspections} was found`,
      );
    }
  },

  logError(message) {
    console.error(`DjangoQL: ${message}`); // eslint-disable-line no-console
  },

  onCompletionMouseClick(e) {
    this.selectCompletion(
      parseInt(e.currentTarget.getAttribute('data-index'), 10),
    );
  },

  onCompletionMouseDown(e) {
    // This is needed to prevent 'blur' event on textarea
    e.preventDefault();
  },

  onKeydown(e) {
    switch (e.keyCode) {
      case 38: // up arrow
        if (this.suggestions.length) {
          if (this.selected === null) {
            this.selected = this.suggestions.length - 1;
          } else if (this.selected === 0) {
            this.selected = null;
          } else {
            this.selected -= 1;
          }
          this.renderCompletion();
          e.preventDefault();
        }
        break;

      case 40: // down arrow
        if (this.suggestions.length) {
          if (this.selected === null) {
            this.selected = 0;
          } else if (this.selected < this.suggestions.length - 1) {
            this.selected += 1;
          } else {
            this.selected = null;
          }
          this.renderCompletion();
          e.preventDefault();
        }
        break;

      case 9: // Tab
        if (this.selected !== null) {
          this.selectCompletion(this.selected);
          e.preventDefault();
        }
        break;

      case 13: // Enter
        // Technically this is a textarea, due to automatic multi-line feature,
        // but other than that it should look and behave like a normal input.
        // So expected behavior when pressing Enter is to submit the form,
        // not to add a new line.
        if (this.selected !== null) {
          this.selectCompletion(this.selected);
        } else if (typeof this.options.onSubmit === 'function') {
          this.options.onSubmit(this.textarea.value);
        } else {
          e.currentTarget.form.submit();
        }
        e.preventDefault();
        break;

      case 27: // Esc
        this.hideCompletion();
        break;

      case 16: // Shift
      case 17: // Ctrl
      case 18: // Alt
      case 91: // Windows Key or Left Cmd on Mac
      case 93: // Windows Menu or Right Cmd on Mac
        // Control keys shouldn't trigger completion popup
        break;

      default:
        // When keydown is fired input value has not been updated yet,
        // so we need to wait
        window.setTimeout(this.popupCompletion, 10);
        break;
    }
  },

  textareaResize() {
    // Automatically grow/shrink textarea to have the contents always visible
    const style = window.getComputedStyle(this.textarea, null);
    const heightOffset = parseFloat(style.paddingTop)
      + parseFloat(style.paddingBottom);
    this.textarea.style.height = '5px';
    // dirty hack, works for Django admin styles only.
    // Ping me if you know how to get rid of "+1"
    const height = (this.textarea.scrollHeight - heightOffset) + 1;
    this.textarea.style.height = `${height}px`;
  },

  popupCompletion() {
    this.generateSuggestions();
    this.renderCompletion();
  },

  selectCompletion(index) {
    const context = this.getContext(
      this.textarea.value,
      this.textarea.selectionStart,
    );
    const { currentFullToken } = context;
    let textValue = this.textarea.value;
    const startPos = this.textarea.selectionStart - context.prefix.length;
    let tokenEndPos = null;

    // cutting current token from the string
    if (currentFullToken) {
      tokenEndPos = currentFullToken.end;
      textValue = (
        textValue.slice(0, startPos) + textValue.slice(tokenEndPos)
      );
    }

    const textBefore = textValue.slice(0, startPos);
    let textAfter = textValue.slice(startPos);
    // preventing double spaces after pasting the suggestion
    textAfter = textAfter.trim();

    const completion = this.suggestions[index];
    let { snippetBefore, snippetAfter } = completion;
    const snippetAfterParts = snippetAfter.split('|');
    if (snippetAfterParts.length > 1) {
      snippetAfter = snippetAfterParts.join('');
      if (!snippetBefore && !completion.text) {
        [snippetBefore, snippetAfter] = snippetAfterParts;
      }
    }
    if (textBefore.endsWith(snippetBefore)) {
      snippetBefore = '';
    }
    if (textAfter.startsWith(snippetAfter)) {
      snippetAfter = '';
    }
    const textToPaste = snippetBefore + completion.text + snippetAfter;
    let cursorPosAfter = textBefore.length + textToPaste.length;
    if (snippetAfterParts.length > 1) {
      cursorPosAfter -= snippetAfterParts[1].length;
    }

    this.textarea.value = textBefore + textToPaste + textAfter;
    this.textarea.focus();
    this.textarea.setSelectionRange(cursorPosAfter, cursorPosAfter);
    this.selected = null;
    if (this.textareaResize) {
      this.textareaResize();
    }
    this.generateSuggestions(this.textarea);
    this.renderCompletion();
  },

  hideCompletion() {
    this.selected = null;
    if (this.completion) {
      this.completion.style.display = 'none';
    }
  },

  highlight(text, highlight) {
    if (!highlight || !text) {
      return text;
    }
    if (this.highlightCaseSensitive) {
      return text.split(highlight).join(`<b>${highlight}</b>`);
    }
    return text.replace(
      new RegExp(`(${escapeRegExp(highlight)})`, 'ig'),
      '<b>$1</b>',
    );
  },

  renderCompletion(dontForceDisplay) {
    let currentLi;
    let i;
    let completionRect;
    let currentLiRect;
    let liLen;
    let loadingElement;

    if (!this.completionEnabled) {
      this.hideCompletion();
      return;
    }

    if (dontForceDisplay && this.completion.style.display === 'none') {
      return;
    }
    if (!this.suggestions.length && !this.loading) {
      this.hideCompletion();
      return;
    }

    const suggestionsLen = this.suggestions.length;
    const li = [].slice.call(
      this.completionUL.querySelectorAll('li[data-index]'),
    );
    liLen = li.length;

    // Update or create necessary elements
    for (i = 0; i < suggestionsLen; i++) {
      if (i < liLen) {
        currentLi = li[i];
      } else {
        currentLi = document.createElement('li');
        currentLi.setAttribute('data-index', i);
        currentLi.addEventListener('click', this.onCompletionMouseClick);
        currentLi.addEventListener('mousedown', this.onCompletionMouseDown);
        this.completionUL.appendChild(currentLi);
      }
      currentLi.innerHTML = this.highlight(
        this.suggestions[i].suggestionText,
        this.prefix,
      );
      if (i === this.selected) {
        currentLi.className = 'active';
        currentLiRect = currentLi.getBoundingClientRect();
        completionRect = this.completionUL.getBoundingClientRect();
        if (currentLiRect.bottom > completionRect.bottom) {
          this.completionUL.scrollTop = this.completionUL.scrollTop + 2
            + (currentLiRect.bottom - completionRect.bottom);
        } else if (currentLiRect.top < completionRect.top) {
          this.completionUL.scrollTop = this.completionUL.scrollTop - 2
            - (completionRect.top - currentLiRect.top);
        }
      } else {
        currentLi.className = '';
      }
    }
    // Remove redundant elements
    while (liLen > suggestionsLen) {
      liLen--;
      li[liLen].removeEventListener('click', this.onCompletionMouseClick);
      li[liLen].removeEventListener('mousedown', this.onCompletionMouseDown);
      this.completionUL.removeChild(li[liLen]);
    }

    loadingElement = this.completionUL.querySelector('li.djangoql-loading');

    if (this.loading) {
      if (!loadingElement) {
        loadingElement = document.createElement('li');
        loadingElement.className = 'djangoql-loading';
        loadingElement.innerHTML = '&nbsp;';
        this.completionUL.appendChild(loadingElement);
      }
    } else if (loadingElement) {
      this.completionUL.removeChild(loadingElement);
    }

    const inputRect = this.textarea.getBoundingClientRect();
    const top = window.pageYOffset + inputRect.top + inputRect.height;
    this.completion.style.top = `${top}px`;
    this.completion.style.left = `${inputRect.left}px`;
    this.completion.style.display = 'block';
  },

  resolveName(name) {
    // Walk through introspection definitions and get target model and field
    let f;
    let i;
    let l;
    const nameParts = name.split('.');
    let model = this.currentModel;
    let field = null;

    const modelStack = [];
    if (model) {
      modelStack.push(model);
      for (i = 0, l = nameParts.length; i < l; i++) {
        f = this.models[model][nameParts[i]];
        if (!f) {
          model = null;
          field = null;
          break;
        } else if (f.type === 'relation') {
          model = f.relation;
          modelStack.push(model);
          field = null;
        } else {
          field = nameParts[i];
        }
      }
    }
    return { modelStack, model, field };
  },

  getContext(text, cursorPos) {
    // This function returns an object with the following 4 properties:
    let prefix; // text already entered by user in the current scope
    let scope = null; // 'field', 'comparison', 'value', 'logical' or null
    let model = null; // model, set for 'field', 'comparison' and 'value'
    let field = null; // field, set for 'comparison' and 'value'
    // Stack of models that includes all entered models
    let modelStack = [this.currentModel];

    let nameParts;
    let resolvedName;
    let lastToken = null;
    let nextToLastToken = null;
    const tokens = this.lexer.setInput(text.slice(0, cursorPos)).lexAll();
    const allTokens = this.lexer.setInput(text).lexAll();
    let currentFullToken = null;
    if (tokens.length && tokens[tokens.length - 1].end >= cursorPos) {
      // if cursor is positioned on the last token then remove it.
      // We are only interested in tokens preceding current.
      currentFullToken = allTokens[tokens.length - 1];
      tokens.pop();
    }
    if (tokens.length) {
      lastToken = tokens[tokens.length - 1];
      if (tokens.length > 1) {
        nextToLastToken = tokens[tokens.length - 2];
      }
    }

    // Current token which is currently being typed may be not complete yet,
    // so lexer may fail to recognize it correctly. So we define current token
    // prefix as a string without whitespace positioned after previous token
    // and until current cursor position.
    prefix = text.slice(lastToken ? lastToken.end : 0, cursorPos);
    const whitespace = prefix.match(whitespaceRegex);
    if (whitespace) {
      prefix = prefix.slice(whitespace[0].length);
    }
    if (prefix === '(') {
      // Paren should not be a part of suggestion
      prefix = '';
    }

    const logicalTokens = ['AND', 'OR'];
    if (prefix === ')' && !whitespace) {
      // Nothing to suggest right after right paren
    } else if (!lastToken
      || (logicalTokens.indexOf(lastToken.name) >= 0 && whitespace)
      || (prefix === '.' && lastToken && !whitespace)
      || (lastToken.name === 'PAREN_L'
        && (!nextToLastToken
          || logicalTokens.indexOf(nextToLastToken.name) >= 0))) {
      scope = 'field';
      model = this.currentModel;
      if (prefix === '.') {
        prefix = text.slice(lastToken.start, cursorPos);
      }
      nameParts = prefix.split('.');
      if (nameParts.length > 1) {
        // use last part as a prefix, analyze preceding parts to get the model
        prefix = nameParts.pop();
        resolvedName = this.resolveName(nameParts.join('.'));
        if (resolvedName.model && !resolvedName.field) {
          model = resolvedName.model;
          modelStack = resolvedName.modelStack;
        } else {
          // if resolvedName.model is null that means that model wasn't found.
          // if resolvedName.field is NOT null that means that the name
          // preceding current prefix is a concrete field and not a relation,
          // and therefore it can't have any properties.
          scope = null;
          model = null;
        }
      }
    } else if (lastToken
      && whitespace
      && nextToLastToken
      && nextToLastToken.name === 'NAME'
      && ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'GREATER_EQUAL',
        'GREATER', 'LESS_EQUAL', 'LESS'].indexOf(lastToken.name) >= 0) {
      resolvedName = this.resolveName(nextToLastToken.value);
      if (resolvedName.model) {
        scope = 'value';
        model = resolvedName.model;
        field = resolvedName.field;
        modelStack = resolvedName.modelStack;
        if (prefix[0] === '"' && (this.models[model][field].type === 'str'
            || this.models[model][field].options)) {
          prefix = prefix.slice(1);
        }
      }
    } else if (lastToken && whitespace && lastToken.name === 'NAME') {
      resolvedName = this.resolveName(lastToken.value);
      if (resolvedName.model) {
        scope = 'comparison';
        model = resolvedName.model;
        field = resolvedName.field;
        modelStack = resolvedName.modelStack;
      }
    } else if (lastToken
      && whitespace
      && ['PAREN_R', 'INT_VALUE', 'FLOAT_VALUE', 'STRING_VALUE']
        .indexOf(lastToken.name) >= 0) {
      scope = 'logical';
    }

    return {
      prefix,
      scope,
      model,
      field,
      currentFullToken,
      modelStack,
    };
  },

  getCurrentFieldOptions() {
    const input = this.textarea;
    const ctx = this.getContext(input.value, input.selectionStart);
    const model = this.models[ctx.model];
    const field = ctx.field && model[ctx.field];
    const fieldOptions = {
      cacheKey: null,
      context: ctx,
      field,
      model,
      options: null,
    };

    if (ctx.scope !== 'value' || !field || !field.options) {
      return null;
    }
    if (Array.isArray(field.options)) {
      fieldOptions.options = field.options;
    } else if (field.options === true) {
      // Means get via API
      if (!this.suggestionsAPIUrl) {
        return null;
      }
      fieldOptions.cacheKey = `${ctx.model}.${ctx.field}|${ctx.prefix}`;
    }
    return fieldOptions;
  },

  loadFieldOptions(loadMore) {
    const fieldOptions = this.getCurrentFieldOptions() || {};
    const { context } = fieldOptions;

    if (!fieldOptions.cacheKey) {
      // The context has likely changed, user's cursor is in another position
      return;
    }
    const requestParams = {
      field: `${context.model}.${context.field}`,
      search: context.prefix,
    };

    const cached = this.suggestionsCache.get(fieldOptions.cacheKey) || {};
    if (loadMore && cached.has_next) {
      requestParams.page = cached.page ? cached.page + 1 : 1;
    } else if (cached.page) {
      // At least the first page is already loaded
      return;
    }

    cached.loading = true;
    this.suggestionsCache.set(fieldOptions.cacheKey, cached);

    const requestUrl = setUrlParams(this.suggestionsAPIUrl, requestParams);
    this.getJson(requestUrl, {
      success: function (data) {
        const cache = this.suggestionsCache.get(fieldOptions.cacheKey) || {};
        if (data.page - 1 !== (cache.page || 0)) {
          // either pages were loaded out of order,
          // or cache is no longer exists
          return;
        }
        const cachedData = {
          ...data,
          items: (cache.items || []).concat(data.items),
        };
        this.suggestionsCache.set(fieldOptions.cacheKey, cachedData);
        this.loading = false;
        this.populateFieldOptions();
        this.renderCompletion();
      }.bind(this),
    });
    // Render 'loading' element
    this.populateFieldOptions();
    this.renderCompletion();
  },

  populateFieldOptions(loadMore) {
    const fieldOptions = this.getCurrentFieldOptions();
    if (fieldOptions === null) {
      // 1) we are out of field options context
      // 2) field has no options
      return;
    }
    let { options } = fieldOptions;
    const prefix = fieldOptions.context && fieldOptions.context.prefix;
    let cached;

    if (options) {
      // filter them locally
      if (this.valuesCaseSensitive) {
        options = options.filter((item) => (
          // Case-sensitive
          item.indexOf(prefix) >= 0
        ));
      } else {
        options = options.filter((item) => (
          // Case-insensitive
          item.toLowerCase().indexOf(prefix.toLowerCase()) >= 0
        ));
      }
    } else {
      this.suggestions = [];
      if (!fieldOptions.cacheKey) {
        return;
      }
      cached = this.suggestionsCache.get(fieldOptions.cacheKey) || {};
      options = cached.items || [];
      if (!cached.loading
          && (!cached.page || (loadMore && cached.has_next))) {
        this.debouncedLoadFieldOptions(loadMore);
      }
      if (!options.length) {
        // Should we show 'no results' message?
        return;
      }
    }

    this.highlightCaseSensitive = this.valuesCaseSensitive;
    this.suggestions = options.map((f) => suggestion(f, '"', '"'));
  },

  onCompletionScroll() {
    const rectHeight = this.completionUL.getBoundingClientRect().height;
    const scrollBottom = this.completionUL.scrollTop + rectHeight;
    if (scrollBottom > rectHeight
        && scrollBottom > (this.completionUL.scrollHeight - rectHeight)) {
      // TODO: add some checks of context?
      this.populateFieldOptions(true);
    }
  },

  generateSuggestions() {
    const input = this.textarea;
    let suggestions;
    let snippetAfter;
    let searchFilter;

    if (!this.completionEnabled) {
      this.prefix = '';
      this.suggestions = [];
      return;
    }

    if (!this.currentModel) {
      // Introspections are not loaded yet
      return;
    }
    if (input.selectionStart !== input.selectionEnd) {
      // We shouldn't show suggestions when something is selected
      this.prefix = '';
      this.suggestions = [];
      return;
    }

    // default search filter - find anywhere in the string, case-sensitive
    searchFilter = function (item) {
      return item.text.indexOf(this.prefix) >= 0;
    }.bind(this);
    // default highlight mode - case sensitive
    this.highlightCaseSensitive = true;

    const context = this.getContext(input.value, input.selectionStart);
    const { modelStack } = context;
    this.prefix = context.prefix;
    const model = this.models[context.model];
    const field = context.field && model[context.field];

    switch (context.scope) {
      case 'field':
        this.suggestions = Object.keys(model).filter((f) => {
          const { relation } = model[f];
          if ((model[f].type === 'relation')
            // Check that the model from a field relation wasn't in the stack
            && modelStack.includes(relation)
            // Last element in the stack could be equal to context model.
            // E.g. an "author" can have the "authors_in_genre" relation
            && (modelStack.slice(-1)[0] !== relation)
          ) {
            return false;
          }
          return true;
        }).map((f) => (
          suggestion(f, '', model[f].type === 'relation' ? '.' : ' ')
        ));
        break;

      case 'comparison':
        suggestions = ['=', ['!=', 'is not equal to']];
        snippetAfter = ' ';
        if (field && field.type !== 'bool') {
          if (['date', 'datetime'].indexOf(field.type) >= 0) {
            suggestions.push(
              ['~', 'contains'],
              ['!~', 'does not contain'],
            );
            snippetAfter = ' "|"';
          } else if (field.type === 'str') {
            suggestions.push(
              ['~', 'contains'],
              ['!~', 'does not contain'],
              'startswith',
              'not startswith',
              'endswith',
              'not endswith',
            );
            snippetAfter = ' "|"';
          } else if (field.options) {
            snippetAfter = ' "|"';
          }
          if (field.type !== 'str') {
            suggestions.push('>', '>=', '<', '<=');
          }
        }
        this.suggestions = suggestions.map((s) => {
          if (typeof s === 'string') {
            return suggestion(s, '', snippetAfter);
          }
          return suggestion(s[0], '', snippetAfter, s[1]);
        });
        if (field && field.type !== 'bool') {
          if (['str', 'date', 'datetime'].indexOf(field.type) >= 0
              || field.options) {
            snippetAfter = ' ("|")';
          } else {
            snippetAfter = ' (|)';
          }
          this.suggestions.push(suggestion('in', '', snippetAfter));
          this.suggestions.push(suggestion('not in', '', snippetAfter));
        }
        // use "starts with" search filter instead of default
        searchFilter = function (item) {
          // See http://stackoverflow.com/a/4579228
          return item.text.lastIndexOf(this.prefix, 0) === 0;
        }.bind(this);
        break;

      case 'value':
        if (!field) {
          // related field
          this.suggestions = [suggestion('None', '', ' ')];
        } else if (field.options) {
          this.prefix = context.prefix;
          this.populateFieldOptions();
        } else if (field.type === 'bool') {
          this.suggestions = [
            suggestion('True', '', ' '),
            suggestion('False', '', ' '),
          ];
          if (field.nullable) {
            this.suggestions.push(suggestion('None', '', ' '));
          }
        } else if (field.type === 'unknown') {
          // unknown field type, reset suggestions
          this.prefix = '';
          this.suggestions = [];
        }
        break;

      case 'logical':
        this.suggestions = [
          suggestion('and', '', ' '),
          suggestion('or', '', ' '),
        ];
        break;

      default:
        this.prefix = '';
        this.suggestions = [];
    }
    this.suggestions = this.suggestions.filter(searchFilter);
    if (this.suggestions.length === 1) {
      this.selected = 0; // auto-select the only suggested item
    } else {
      this.selected = null;
    }
  },

};

export default DjangoQL;
