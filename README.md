# Book Learning

A minimal local app for studying books: read by chapter and section, answer questions, take timed tests, track progress, and collect favorite words with every sentence that uses them.

There is nothing to install except [Node.js](https://nodejs.org) 18 or newer.

```sh
make run
```

Then open <http://localhost:3000>. To use another port, run `make run PORT=8080`. Without `make`, run `node server.js`.

After adding or editing a book, `make check` reports any mistakes in `books/`. Run `make` on its own to list the commands.

## Folders

| Path | What it holds |
| --- | --- |
| `books/` | One JSON file per book. The file name is the book's ID. |
| `progress/` | One JSON file per book, plus `_words.json` for favorite words. Created automatically. |
| `public/` | The web page. |
| `server.js` | The local server. |

To back up or move your progress, copy `progress/`. To reset a book, stop the server and delete its file there.

## Adding a book

Add a file such as `books/my-book.json`, then reload the page. A book with a mistake in it appears in the library with a message saying what's wrong.

```json
{
  "title": "My Book",
  "author": "Optional",
  "chapters": [
    {
      "title": "Chapter 1",
      "sections": [
        {
          "title": "Section 1",
          "text": ["First paragraph.", "Second paragraph."],
          "questions": []
        }
      ]
    }
  ]
}
```

### Question types

For `single`, `dropdown` and `multiple`, `answer` gives the position in `options`, starting from 0. `explain` is optional on every type, and is shown once the question is answered correctly or the answer is revealed.

```json
{ "type": "single", "q": "One correct option", "options": ["A", "B", "C"], "answer": 1, "explain": "Why B is right." }
{ "type": "multiple", "q": "Several correct options", "options": ["A", "B", "C"], "answer": [0, 2] }
{ "type": "dropdown", "q": "Pick from a dropdown", "options": ["A", "B", "C"], "answer": 2 }
{ "type": "fill", "q": "Type the answer", "answer": ["colour", "color"] }
```

`fill` ignores upper/lower case, extra spaces, curly apostrophes and a final `.`, `!` or `?`. List every other form you want to accept.

## How it behaves

- **Progress** counts questions answered correctly while reading, and rolls up from section to chapter to book.
- **Tests** use the same questions from the book file. Choose a section, chapter, final or random test, then set the number of questions and a time limit. Questions are picked and ordered randomly.
- **Saved tests:** every finished test is kept with its answers and score, and doesn't change the reading progress bars. An unfinished test resumes after a reload. Its timer keeps running while you're away, and it's scored automatically when time runs out.
- **Editing a book:** answers are stored by chapter title, section title and question text. You can reorder content freely, but changing any of that text resets the affected answers.
- **Favorite words:** click a word while reading to save it, and click it again to remove it. The Words page lists every sentence containing it, from all books, and lets you add a note.
- **Word matching** is exact apart from case, so `run` won't find `runs`. Save each form you want to track.
- **Access:** the server only accepts connections from your own computer.
