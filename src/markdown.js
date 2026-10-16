// Project:   Claudemeter
// File:      markdown.js
// Purpose:   Render an outside string as literal text inside a tooltip.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Tooltips are trusted MarkdownStrings, where a link or autolink to a
// `command:` URI executes on click, so link, autolink and code syntax is
// escaped along with the emphasis markers that would restyle a name.
// Underscore is left alone: it is inert inside a word, and env var names and
// error codes are full of it.
function escapeMarkdown(value) {
    return String(value).replace(/[[\]()`<>\\*~]/g, '\\$&');
}

module.exports = { escapeMarkdown };
