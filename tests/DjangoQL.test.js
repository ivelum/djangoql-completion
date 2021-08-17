import DjangoQL from '@/index';

let djangoQL;
let token;

describe('test DjangoQL completion', () => {
  beforeEach(() => {
    document.body.innerHTML = '<textarea name="test"></textarea>';

    djangoQL = new DjangoQL({
      introspections: {
        current_model: 'core.book',
        models: {
          'auth.group': {
            user: {
              type: 'relation',
              relation: 'auth.user',
            },
            id: {
              type: 'int',
              relation: null,
            },
            name: {
              type: 'str',
              relation: null,
            },
          },
          'auth.user': {
            book: {
              type: 'relation',
              relation: 'core.book',
            },
            id: {
              type: 'int',
              relation: null,
            },
            password: {
              type: 'str',
              relation: null,
            },
            last_login: {
              type: 'datetime',
              relation: null,
            },
            is_superuser: {
              type: 'bool',
              relation: null,
            },
            username: {
              type: 'str',
              relation: null,
            },
            first_name: {
              type: 'str',
              relation: null,
            },
            last_name: {
              type: 'str',
              relation: null,
            },
            email: {
              type: 'str',
              relation: null,
            },
            is_staff: {
              type: 'bool',
              relation: null,
            },
            is_active: {
              type: 'bool',
              relation: null,
            },
            date_joined: {
              type: 'datetime',
              relation: null,
            },
            groups: {
              type: 'relation',
              relation: 'auth.group',
            },
          },
          'core.book': {
            id: {
              type: 'int',
              relation: null,
            },
            name: {
              type: 'str',
              relation: null,
            },
            author: {
              type: 'relation',
              relation: 'auth.user',
            },
            written: {
              type: 'datetime',
              relation: null,
            },
            is_published: {
              type: 'bool',
              relation: null,
            },
            rating: {
              type: 'float',
              relation: null,
            },
            price: {
              type: 'float',
              relation: null,
            },
          },
        },
      },
      selector: 'textarea[name=test]',
      autoresize: true,
    });
    token = djangoQL.token;
  });

  describe('.init()', () => {
    it('should properly read introspection data', () => {
      expect(djangoQL.currentModel).toBe('core.book');
    });
  });

  describe('.lexer', () => {
    it('should understand punctuation and ignore white space', () => {
      const tokens = [
        token('PAREN_L', '('),
        token('PAREN_R', ')'),
        token('DOT', '.'),
        token('COMMA', ','),
        token('EQUALS', '='),
        token('NOT_EQUALS', '!='),
        token('GREATER', '>'),
        token('GREATER_EQUAL', '>='),
        token('LESS', '<'),
        token('LESS_EQUAL', '<='),
        token('CONTAINS', '~'),
        token('NOT_CONTAINS', '!~'),
      ];
      djangoQL.lexer.setInput('() ., = != >\t >= < <= ~ !~');
      tokens.forEach((t) => {
        expect(djangoQL.lexer.lex()).toStrictEqual(t);
      });
      expect(djangoQL.lexer.lex()).toBeFalsy(); // end of input
    });

    it('should recognize names', () => {
      const names = ['a', 'myVar_42', '__LOL__', '_', '_0'];
      djangoQL.lexer.setInput(names.join(' '));
      names.forEach((name) => {
        expect(djangoQL.lexer.lex()).toStrictEqual(token('NAME', name));
      });
    });

    it('should recognize reserved words', () => {
      const words = ['True', 'False', 'None', 'or', 'and', 'in'];
      djangoQL.lexer.setInput(words.join(' '));
      words.forEach((word) => {
        expect(djangoQL.lexer.lex())
          .toStrictEqual(token(word.toUpperCase(), word));
      });
    });

    it('should recognize strings', () => {
      const strings = ['""', '"42"', '"\\t\\n\\u0042 \\" ^"'];
      djangoQL.lexer.setInput(strings.join(' '));
      strings.forEach((s) => {
        expect(djangoQL.lexer.lex())
          .toStrictEqual(token('STRING_VALUE', s.slice(1, s.length - 1)));
      });
    });

    it('should parse int values', () => {
      const numbers = ['0', '-0', '42', '-42'];
      djangoQL.lexer.setInput(numbers.join(' '));
      numbers.forEach((num) => {
        expect(djangoQL.lexer.lex()).toStrictEqual(token('INT_VALUE', num));
      });
    });

    it('should parse float values', () => {
      const numbers = ['-0.5e+42', '42.0', '2E64', '2.71e-0002'];
      djangoQL.lexer.setInput(numbers.join(' '));
      numbers.forEach((num) => {
        expect(djangoQL.lexer.lex()).toStrictEqual(token('FLOAT_VALUE', num));
      });
    });
  });

  describe('.resolveName()', () => {
    it('should properly resolve known names', () => {
      expect(djangoQL.resolveName('price'))
        .toStrictEqual({ model: 'core.book', field: 'price' });
      expect(djangoQL.resolveName('author'))
        .toStrictEqual({ model: 'auth.user', field: null });
      expect(djangoQL.resolveName('author.first_name'))
        .toStrictEqual({ model: 'auth.user', field: 'first_name' });
      expect(djangoQL.resolveName('author.groups'))
        .toStrictEqual({ model: 'auth.group', field: null });
      expect(djangoQL.resolveName('author.groups.id'))
        .toStrictEqual({ model: 'auth.group', field: 'id' });
      expect(djangoQL.resolveName('author.groups.user'))
        .toStrictEqual({ model: 'auth.user', field: null });
      expect(djangoQL.resolveName('author.groups.user.email'))
        .toStrictEqual({ model: 'auth.user', field: 'email' });
    });
    it('should return nulls for unknown names', () => {
      ['gav', 'author.gav', 'author.groups.gav'].forEach((name) => {
        expect(djangoQL.resolveName(name))
          .toStrictEqual({ model: null, field: null });
      });
    });
  });

  describe('.getScope()', () => {
    it('should properly detect scope and prefix', () => {
      const book = djangoQL.currentModel;
      const examples = [
        {
          args: ['', 0],
          result: {
            prefix: '',
            scope: 'field',
            model: book,
            field: null,
          },
        },
        {
          args: ['just some text after cursor', 0],
          result: {
            prefix: '',
            scope: 'field',
            model: book,
            field: null,
          },
        },
        {
          args: ['random_word', 4], // cursor is at the end of word
          result: {
            prefix: 'rand',
            scope: 'field',
            model: book,
            field: null,
          },
        },
        {
          args: ['random', 6], // cursor is at the end of word
          result: {
            prefix: 'random',
            scope: 'field',
            model: book,
            field: null,
          },
        },
        {
          args: ['id', 2], // cursor is at the end of known field
          result: {
            prefix: 'id',
            scope: 'field',
            model: book,
            field: null,
          },
        },
        {
          args: ['id ', 3], // cursor is after known field
          result: {
            prefix: '',
            scope: 'comparison',
            model: book,
            field: 'id',
          },
        },
        {
          args: ['id >', 4], // cursor is at the end of comparison
          result: {
            prefix: '>',
            scope: 'comparison',
            model: book,
            field: 'id',
          },
        },
        {
          args: ['id > ', 5], // cursor is after comparison
          result: {
            prefix: '',
            scope: 'value',
            model: book,
            field: 'id',
          },
        },
        {
          args: ['id > 1', 6], // entering value
          result: {
            prefix: '1',
            scope: 'value',
            model: book,
            field: 'id',
          },
        },
        {
          args: ['id > 1 ', 7], // cursor is after value
          result: {
            prefix: '',
            scope: 'logical',
            model: null,
            field: null,
          },
        },
        {
          args: ['id > 1 hmm', 10], // entering logical
          result: {
            prefix: 'hmm',
            scope: 'logical',
            model: null,
            field: null,
          },
        },
        {
          args: ['id > 1 and ', 11], // entered good logical
          result: {
            prefix: '',
            scope: 'field',
            model: book,
            field: null,
          },
        },
        {
          args: ['id > 1 and author.', 18], // referencing related model
          result: {
            prefix: '',
            scope: 'field',
            model: 'auth.user',
            field: null,
          },
        },
        {
          args: ['id > 1 and author.i', 19], // typing field of related model
          result: {
            prefix: 'i',
            scope: 'field',
            model: 'auth.user',
            field: null,
          },
        },
        {
          args: ['(id = 1) ', 9], // cursor is after right paren and space
          result: {
            prefix: '',
            scope: 'logical',
            model: null,
            field: null,
          },
        },
        {
          args: ['(id = 1) a', 10], // typing after right paren
          result: {
            prefix: 'a',
            scope: 'logical',
            model: null,
            field: null,
          },
        },
        {
          args: ['(id = 1)', 1], // cursor is right after left paren
          result: {
            prefix: '',
            scope: 'field',
            model: book,
            field: null,
          },
        },
        {
          args: ['(id = 1)', 2], // cursor is 1 symbol after left paren
          result: {
            prefix: 'i',
            scope: 'field',
            model: book,
            field: null,
          },
        },
      ];
      examples.forEach((e) => {
        const result = djangoQL.getContext(...e.args);
        delete result.currentFullToken; // it's not relevant in this case
        expect(result).toStrictEqual(e.result);
      });
    });

    it('should return nulls for unknown cases', () => {
      const examples = [
        ['random_word ', 12], // cursor is after unknown field
        ['id > 1 hmm ', 11], // entered bad logical
        ['(id = 1)', 8], // just after right paren
        ['a = "', 5], // just after a quote
      ];
      examples.forEach((example) => {
        const context = djangoQL.getContext(...example);
        expect(context.scope).toBeNull();
        expect(context.model).toBeNull();
        expect(context.field).toBeNull();
      });
    });
  });

  describe('.generateSuggestions()', () => {
    it('should not have circular deps', () => {
      djangoQL.textarea.value = 'author.';
      djangoQL.generateSuggestions();
      // "book.author.book" sholdn't be suggested
      expect(djangoQL.suggestions).toEqual(
        expect.not.arrayContaining([{
          snippetAfter: ".",
          snippetBefore: "",
          suggestionText: "book",
          text: "book",
        }])
      );
      
      // Change model and test in reverse side
      djangoQL.setCurrentModel('core.author');
      djangoQL.textarea.value = 'book.';
      djangoQL.generateSuggestions();
      expect(djangoQL.suggestions).toEqual(
        expect.not.arrayContaining([{
          snippetAfter: ".",
          snippetBefore: "",
          suggestionText: "author",
          text: "author",
        }])
      );

      // Add words one be one to build the Model Stack
      djangoQL.setCurrentModel('auth.group');
      djangoQL.textarea.value = 'user.';
      djangoQL.generateSuggestions();
      expect(djangoQL.suggestions).toEqual(
        expect.arrayContaining([{
          snippetAfter: ".",
          snippetBefore: "",
          suggestionText: "book",
          text: "book",
        }])
      );
      djangoQL.textarea.value = 'user.book.';
      djangoQL.generateSuggestions();
      // "User" model is already in the Model Stack
      expect(djangoQL.suggestions).toEqual(
        expect.not.arrayContaining([{
          snippetAfter: ".",
          snippetBefore: "",
          suggestionText: "author",
          text: "author",
        }])
      );
    });
  });
});
