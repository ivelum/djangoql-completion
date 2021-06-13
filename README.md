# DjangoQL completion widget

Syntax completion widget for [DjangoQL](https://github.com/ivelum/djangoql).

## Installation

DjangoQL completion widget is available at npm as
[djangoql-completion](https://www.npmjs.com/package/djangoql-completion). 
You can install it using npm or yarn.

Using npm:
```shell
$ npm i --save djangoql-completion
```

## Usage

First, you should create a `<textarea>` element somewhere on your page which
will receive the user input and provide DjangoQL syntax completions. You can
optionally pre-populate its contents with an existing query that user will be
able to edit:

```html
<textarea name="q">name ~ "war" and author.name = "Tolstoy"</textarea>
```

Next, load the completion widget styles. If you're using Webpack with 
[css-loader](https://webpack.js.org/loaders/css-loader/), you can import it
right from your JavaScript code:

```javascript
import 'djangoql-completion/dist/completion.css';
```
Please feel free to override the default styles to achieve the appropriate
widget look and feel for your project.

Finally, initialize the completion widget for the `<textarea>` that you created:
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
  
  // Should the <textarea> automatically grow vertically for long query inputs 
  autoResize: true,
  
  // URL for the syntax help page (optional)
  syntaxHelp: null,
  
  onSubmit: function(value) {
    // Callback for the submit event. Receives the textarea value as a parameter 
  },
});

// Once completion widget is initialized, you can control it using the 
// following methods:
//
// Popup the completions dialog (can be useful immediately after initialization,
// if you'd like to show users that completion is available):
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
