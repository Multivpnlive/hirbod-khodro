<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Access control lives in database RLS (admin via `has_role`, partners via `my_partner_ids()`); UI role checks are cosmetic only.
- Partners get deal totals only through the `my_car_shares()` function so other partners' capital stays hidden.
- Demo rows carry `is_demo = true`; the UI filters them with a toggle so real data stays separate.
- Profit math lives in `src/lib/finance.ts` with tests in `finance.test.ts`.
- Dates are stored as Gregorian `YYYY-MM-DD` in the DB; all UI input/display goes through `src/lib/jalali.ts` (jalaali-js) and `JalaliDateField`, parsing via `parseIsoLocal` to avoid timezone day-shifts.
