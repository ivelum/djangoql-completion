# DjangoQL completion widget

An autocompletion widget for [DjangoQL](https://github.com/ivelum/djangoql)
that you can embed inside your own custom JavaScript application.

## Installation

The DjangoQL completion widget is available at npm as
[djangoql-completion](https://www.npmjs.com/package/djangoql-completion). 
You can install it using npm or yarn.

Using npm:
```shell
$ npm i --save djangoql-completion
```

## Version compatibility

- For [DjangoQL](https://github.com/ivelum/djangoql) v0.16.0+ please use 
  ``djangoql-completion`` v0.5.0+;
- [DjangoQL](https://github.com/ivelum/djangoql) v0.15.4 and older: the latest
  version of ``djangoql-completion`` that supports these releases is v0.4.0.

## Usage

1. Somewhere on your page, create a `<textarea>` element that can receive user
input and provide DjangoQL syntax completions. You can optionally pre-populate
its contents with an existing query that users can edit:

```html
<textarea name="q">name ~ "war" and author.name = "Tolstoy"</textarea>
```

2. Load the completion widget styles. If you're using Webpack with
[css-loader](https://webpack.js.org/loaders/css-loader/), you can import the
styles right from your JavaScript code:

```javascript
import 'djangoql-completion/dist/completion.css';
```

Feel free to override the default styles to make the widget look right for your
project.

3. Finally, initialize the completion widget for the `<textarea>` that you created:

```javascript
import DjangoQL from 'djangoql-completion';

// Initialize completion widget
const djangoQL = new DjangoQL({
  // Enable completion features upon initialization (true by default)
  completionEnabled: true,
  
  // DjangoQL introspection schema, either as a JavaScript object,
  // or as an URL from which it can be fetched
  introspections: 'introspections/',
  
  // CSS selector for the <textarea> element that you created above
  selector: 'textarea[name=q]',
  
  // For long query inputs, automatically resize the <textarea> vertically
  autoResize: true,
  
  // URL for the syntax help page (optional)
  syntaxHelp: null,
  
  onSubmit: function(value) {
    // Callback for the submit event. Receives the textarea value as a parameter 
  },
});

// Once the completion widget is initialized, you can control it using the
// following methods:
//
// Popup the completions dialog (this might be useful to do immediately after
// initialization, to show users that completion is available):
//     djangoQL.popupCompletion();
//
// Disable completion widget:
//     djangoQL.disableCompletion();
//
// Enable completion widget:
//     djangoQL.enableCompletion();
```

That's it! You should be ready to go. If you need help with DjangoQL itself, 
please refer to its [docs](https://github.com/ivelum/djangoql/).


## License

MIT
