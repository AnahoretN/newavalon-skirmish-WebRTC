# Contributing to New Avalon: Skirmish

Thank you for your interest in contributing to New Avalon: Skirmish!

## Installation

```bash
# Clone the repository
git clone https://github.com/uz0/NewAvalonSkirmish.git
cd NewAvalonSkirmish

# Install dependencies
npm install
```

## Development

### Common Claude Prompts

- **Starting Development Server**: `start dev on bg` - Runs `npm run dev` in background (client + server with HMR)
- **Checking Code Quality**: `check lint and types` - Runs `npm run lint` and `npm run type-check`
- **Adding Translations**: `update locales` - Creates/updates locale file in `client/locales/`, exports from `index.ts`, adds to `types.ts` and `LANGUAGE_NAMES`
- **Version Bump**: `update version to x.x.x based on changes` - Updates `package.json` and `CHANGELOG.md` following semver (MAJOR.MINOR.PATCH)
- **Creating Branch**: `checkout to new branch version-x-x-x` - Runs `git checkout -b feature/name` or `git checkout -b version-X-X-X`

### Version Guidelines

- **MAJOR (X.0.0)**: Breaking changes
- **MINOR (0.X.0)**: New features
- **PATCH (0.0.X)**: Bug fixes & minor changes

### Commit Message Format

```text
VERSION Summary of changes

- Details
- More details
```

## Review Process

### For Contributors

- **Waiting for Code Review**: Wait 2-5 min for CodeRabbit review, address any comments, then request maintainer review

### For Maintainers

- **Merging**: Click "Squash and merge" in GitHub, ensure format `VERSION description`, delete branch
- **Deployment**: Pull latest changes, docker build (`docker build -t newavalonskirmish .`), test on port 8822, deploy to production

## Additional Guidelines

### Code Style

- Use TypeScript for all new code
- Follow existing code formatting
- Run `npm run lint` before committing
- Use meaningful variable/function names

### Testing

Manually test:
- Game creation and joining
- Card interactions
- Language switching
- Settings changes

### Documentation

Update relevant documentation when making changes:
- `CLAUDE.md` - Project structure and API flow (MANDATORY for structural changes)
- `CHANGELOG.md` - Version history (MANDATORY for all releases)
- `CONTRIBUTING.md` - Contribution guidelines (if workflow changes)

### Issues

Before starting work on a new feature:
1. Check existing issues
2. Create an issue if none exists
3. Reference the issue in your PR (e.g., `Fixes #123`)
