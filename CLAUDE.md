# Project

## Overview 
<!-- TODO: briefly describe what this app does, its primary users, and the core technical shape (e.g. language/framework for backend and frontend, monorepo or not). -->

## Prerequisites
<!-- TODO: list runtime dependencies, required tools, and minimum versions (e.g. Node 20+, Python 3.11+, Docker) -->

## Quick Start: Install and Build
<!-- TODO: step-by-step commands to clone, install dependencies, and run locally -->

## Tech Stack
<!-- TODO: list languages, frameworks, libraries, and infrastructure choices with a one-line rationale for each -->

## Architecture

### Folder Structure
<!-- TODO: annotated tree of the repo layout, one line per directory explaining its role -->

### Frontend
<!-- TODO: describe UI framework, state management, routing, and key design decisions -->

### Backend
<!-- TODO: describe server framework, data layer, auth approach, and key design decisions -->

## Communication Flow
<!-- TODO: diagram or prose describing how frontend, backend, and any external services talk to each other (REST, WebSocket, queues, etc.) -->

## App Configuration
<!-- TODO: list all environment variables and config files, their purpose, and example values -->

---

# Claude Instructions

## Tools

* Always use Context7 when you need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
* Always use playwright cli & skills to test the application

## Code Quality
* Prefer correct, complete implementations over minimal ones.
* Use appropriate data structures and algorithms — don't brute-force what has a known better solution.
* When fixing a bug, fix the root cause, not the symptom.
* If something I asked for requires error handling or validation to work reliably, include it without asking.

## Design Principles
* DRY: Every piece of logic has one authoritative place. Extract it when duplication appears — but only when the two instances truly represent the same knowledge, not just similar-looking code.
* KISS: Prefer the simplest solution that correctly solves the problem. Avoid clever abstractions, unnecessary frameworks, or new dependencies when a plain function will do.
* YAGNI: Only implement what is needed now. Do not add hooks, flags, extension points, or generalization for requirements that don't exist yet.
* SRP: Each function, class, or module has one reason to change. Split when a unit serves two distinct concerns.
* OCP: Extend behavior by adding code, not by modifying existing stable code. Use interfaces or composition rather than branching on type.
* LSP: Subtypes must be substitutable for their base type without breaking callers. If an override weakens a contract, the hierarchy is wrong.
* ISP: Don't force callers to depend on methods they don't use. Prefer narrow, focused interfaces over fat ones.
* DIP: High-level modules depend on abstractions, not concrete implementations. Inject dependencies; don't instantiate them inside.

## Planning & Thinking
* Before writing code, identify the minimal change that solves the problem. Start there.
* Do not invent requirements. If the scope is ambiguous, ask one clarifying question rather than covering all cases speculatively.
* Prefer editing existing code over creating new abstractions. New files, classes, and layers need justification.
* If a task can be done in under 20 lines, do not propose an architecture first.
* Always use Context7 when needing library/API documentation, code generation, setup or configuration steps — without waiting to be asked.

## Output Discipline
* Do not summarize what you just did. Code speaks for itself.
* Do not explain changes unless asked. Show the diff, not a tutorial about it.
* Do not add "you might also want to consider..." suggestions unless asked.
* When returning a code fix, return only the changed code — not the full file — unless the full file is necessary for context.

## Change Scope
* Only modify what the task requires. Do not refactor adjacent code unless it directly blocks the task.
* Do not rename variables, reformat files, or reorganize imports unless explicitly asked.
* If you notice a separate issue while working, flag it in one sentence — do not fix it uninvited.