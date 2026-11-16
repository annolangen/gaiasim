# GaiaSim

SimEarth-like web app built with Vite, TypeScript, and Lit.

## Development

Install dependencies once after cloning:

```sh
npm ci
```

Start the development server while working:

```sh
npm run dev
```

Open the URL printed by Vite (currently `http://localhost:8080`). The server
reloads the page as source files change.

## Before submitting

Run all pre-submit steps:

```sh
npm run presubmit
```

This applies GTS's automatic formatting/lint fixes, then checks TypeScript,
runs the simulation tests, lints, and builds the production app. Run just the
tests with `npm test`. Review your diff afterward because `fix` may modify files.

To check the production build locally, run:

```sh
npm run preview
```

This command builds the app first, then serves the generated files at
`http://localhost:8080`.

## Deploying to GitHub Pages

Build the static site:

```sh
npm run build
```

Publish the generated `dist/` directory with GitHub Pages. The build uses
relative asset URLs so it can be served from a project-site path, such as
`https://annolangen.github.io/gaiasim/`.
