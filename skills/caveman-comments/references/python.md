# Python

## NumPy Docstrings

Use NumPy docstring style for every function and class.

- Keep section headers such as `Parameters`, `Returns`, `Raises`, and `Notes`.
- Compress prose inside sections; preserve contracts.
- Tests use one-line docstrings.
- `__init__.py` files contain only a one-line docstring.

```python
def fetch_user(user_id: int) -> User:
    """Fetch user. Cache stale ≤60s.

    Parameters
    ----------
    user_id : int
        Unique id. Negative -> raises.

    Returns
    -------
    User
        Hydrated. Never None.

    Raises
    ------
    ValueError
        user_id < 0.
    """
```

## Comment Prefixes

Preserve prefix; compress only trailing prose.

| Prefix   | Purpose                                          |
|----------|--------------------------------------------------|
| `# ##!:` | Warning, gotcha, pitfall, critical note          |
| `# ##>:` | Explanation, reason, context, business logic     |
| `# ##?:` | Question, uncertainty, needs review              |
| `# ##@:` | TODO, future improvement, planned change         |
| `# ##~:` | Workaround, hack, temporary fix                  |
| `# ##&:` | Dependency, external API behavior, library quirk |
