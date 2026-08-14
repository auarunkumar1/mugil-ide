# Ponytail Module

Output minimization. Produces a system-level instruction that makes the model
behave like the laziest senior dev in the room (the "YAGNI ladder": reuse →
stdlib → native → installed dep → one line → minimum that works), and can
enforce a hard completion-token budget.

**Credits:** inspired by [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
(~54% less code, ~20% cheaper, ~27% faster on real agentic sessions). See
[ATTRIBUTIONS.md](../../../../ATTRIBUTIONS.md).

```ts
import { ponytailInstruction, ponytailOutputBudget } from '@mugil-ide/core';
```
