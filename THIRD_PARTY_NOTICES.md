# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below, distributed under
the MIT License, whose notice is reproduced in full as that license asks.

## weheat

<https://github.com/wefabricate/wh-python>, the Python client of the Weheat
backend published by Weheat B.V. (PyPI package `weheat`), used by the Weheat
integration of Home Assistant. MIT License (`LICENSE` of the repository, tag
`2026.9.3`, read on 2026-10-18).

Ported in `src/constants.js`, `src/api.js` and `src/model.js`: the API host
and paths (heat pump list, latest log, energy totals), the field names of the
log and of the energy totals, the heat pump states, the coefficient of
performance and its sign while cooling, the flow computed from the duty cycle
of the pumps, the sums of the energy totals and the model names. The OAuth
endpoints and scopes come from the Weheat integration of Home Assistant
(`homeassistant/components/weheat`, Apache License 2.0), read, not copied.

```
MIT License

Copyright (c) 2024 Weheat B.V.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
