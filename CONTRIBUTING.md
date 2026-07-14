# Contributing to ZZ Record

Thank you for helping improve ZZ Record. Please keep each pull request focused on one user-facing problem or one maintainability improvement.

## Before opening a pull request

1. Search existing issues and pull requests to avoid duplicate work.
2. Create a branch from `main` and describe the user scenario your change addresses.
3. Run the relevant tests. At minimum, run `npx tsc --noEmit`; run `npm test -- --reporter=dot` when the change affects shared behavior.
4. For recording, camera, audio, editor, or export changes, include concise manual verification steps and screenshots or a short recording when useful.

## Development setup

```bash
git clone https://github.com/zhouzilai626/zz-Record.git
cd zz-Record
npm install
npm run dev
```

Windows native helpers require Visual Studio 2022 (or Build Tools) with the C++ workload and CMake. See [README.md](./README.md) for build requirements.

## Pull request expectations

- Do not include generated `release/`, `dist/`, local recordings, certificates, private keys, or user data.
- Do not re-enable third-party extension execution without a reviewed sandbox and IPC authorization model.
- Preserve the AGPL-3.0 license and Recordly/OpenScreen attribution.
- Explain any user-visible behavior, migration, or compatibility change in the pull request description.

## Reporting bugs and security issues

Use GitHub Issues for normal bugs and feature requests. Do not post exploit details, credentials, certificates, or private recording data in a public issue. Follow [SECURITY.md](./SECURITY.md) for security reports.

## License

By contributing, you agree that your contribution is licensed under the repository's [GNU AGPL-3.0 license](./LICENSE.md).
