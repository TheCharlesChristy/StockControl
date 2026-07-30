# System domain module

This package contains framework-independent application and domain code.

Allowed dependencies:

- `@stockcontrol/contracts`
- the TypeScript standard library

Forbidden dependencies:

- NestJS or another delivery framework
- database, queue, filesystem, or network implementations
- `@stockcontrol/platform`
- either deployable application

Infrastructure is represented by ports and supplied by an outer adapter.
