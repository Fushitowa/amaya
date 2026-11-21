# AMAYA Capstone Defense: Possible Questions

Study guide · 2026-11-20 · 💡 = hint on where to look or what to say. Answer in your own words.

---

## 1. Project overview and purpose

1. What is AMAYA, and who are its users?
2. What problem of Amaya's Drinks and Bites does the system solve? What did they use before?
3. What are your general and specific objectives? Did you meet all of them?
4. What are the scope and limitations of the system?
5. Who are the beneficiaries (owner, cashier, customer, future researchers)?
6. What makes your system different from existing POS systems (Loyverse, Square, Utak)?
7. Why build your own instead of using an existing POS?
8. What is the significance of the study?

## 2. Methodology and process

9. What software development methodology did you use (Agile, Waterfall, Prototyping)? Why?
10. How did you gather requirements? Did you interview the owner?
11. How long did development take? What were your phases?
12. What was the hardest problem you solved? 💡 Ledger integrity, the corrupted `product_ingredients` table repair, size-specific recipes.
13. How did you validate that the system meets the users' needs (UAT, survey, ISO 25010)?
14. What evaluation tool or criteria did you use, and what were the results?

## 3. Technology stack

15. What technologies did you use and why? 💡 React 19 + Vite (front end), Node.js + Express (API), MySQL/MariaDB via XAMPP (database).
16. Why React instead of plain HTML/PHP?
17. Why a separate API server instead of putting everything in one app?
18. Why MySQL instead of a NoSQL database like MongoDB? 💡 Money needs transactions, foreign keys, strict structure.
19. Why are there two front-end apps (customer and portal)? 💡 `vite --mode customer` / `--mode portal`.
20. What is Vite? What is JSX?
21. What is a REST API? Give an example endpoint from your system.
22. What does the `Start_Amaya_Control_Panel.bat` do?
23. Can the system run without internet?

## 4. Database design

24. Show and explain your ERD. How many tables are there?
25. What is normalization? Is your database normalized? Up to what form?
26. What are primary keys and foreign keys? Give examples from your tables.
27. What is a database migration? Why do you have 46 of them? 💡 Schema changes are tracked, ordered, repeatable; `api/src/migrationList.js`.
28. What does `ON DELETE RESTRICT` vs `ON DELETE SET NULL` mean? Where did you use them?
29. Why do you archive records instead of deleting them?
30. What is a database index? Why did you add them (migration 041, 042)?
31. What is a database transaction? Where do you use one? 💡 Recording an expense, closing a shift, placing an order.
32. What happens if two cashiers sell the last item at the same time? 💡 Row locks (`FOR UPDATE`) and stock boundary checks.
33. How do you back up the database? How do you restore it? 💡 `api/src/backup-db.js`, `database/backups/`.

## 5. Accounting and finance (expect many questions here)

34. What is double-entry accounting? Why did you use it in a POS?
35. What is a debit and a credit? Give a real example from AMAYA. 💡 A cash sale: Dr 1010 Cash Drawer / Cr 4010 Sales.
36. What is the Chart of Accounts? Explain your account code numbering (1xxx, 2xxx, 3xxx, 4xxx, 5xxx, 6xxx).
37. What is a journal entry? Why can't they be edited or deleted? 💡 Immutable audit trail; corrections are reversals.
38. How do you correct a wrong entry, then?
39. What is a trial balance? What does it prove?
40. Explain your Income Statement (P&L): gross sales, discounts, net sales, COGS, gross profit, operating expenses, net income.
41. What is COGS, and how does your system compute it automatically? 💡 Recipe ingredients × unit cost, deducted per order.
42. What is gross profit vs net income?
43. Explain your Balance Sheet. What is the accounting equation? 💡 Assets = Liabilities + Equity.
44. Explain your Cash Flow statement: operating, investing, financing.
45. What is the difference between profit and cash? Why can you have profit but no cash?
46. What are Accounts Payable? How do your payables work?
47. What is Owner's Equity? Owner's Capital vs Owner's Drawings?
48. Why is waste/spoilage recorded as a cost?
49. What is depreciation? Does your system handle it?
50. How is VAT handled? Is it enabled? 💡 `vat_enabled`, `vat_rate_pct` in settings.
51. What is food cost percentage? What is your target food cost and why? 💡 `target_food_cost`.
52. How do expense budgets work? How is "spent" calculated?
53. What is the Net Income PIN, and why hide profit figures?

## 6. Inventory

54. How does inventory get deducted when an order is placed?
55. How do you handle different cup sizes using different amounts of ingredients? 💡 Size-specific recipes (migration 008).
56. How do unit conversions work (kg to g, L to mL, packs to pieces)?
57. How is the unit cost of an ingredient computed? 💡 Purchase price ÷ package quantity ÷ contents per package.
58. What are low-stock and critical-stock alerts? How are thresholds set?
59. How does the restock suggestion work? 💡 Usage velocity, `shared/restockSuggestion.js`.
60. How do you log waste? Why is measuring waste important?
61. What happens to stock when an order is voided?
62. How do you prevent stock from going negative?
63. What is an inventory movement? Name the movement types.
64. Is your inventory value in the ledger the same as the inventory table? How do you reconcile them?

## 7. Orders, POS and cashiering

65. Walk us through placing an order from start to receipt.
66. What payment methods are supported?
67. How are discounts applied? Who can apply them?
68. What is a cashier shift/session? Why must a shift be opened?
69. What is opening float, expected cash, counted cash and variance?
70. What happens if the drawer is short or over?
71. How do you void or refund an order? Can a void be undone? 💡 Grace window, partial reversals.
72. What is "owner confirmation" of cashier sales, and why?
73. Can a cashier record an expense? What are the limits? 💡 Counter cash only, today only, needs an open shift.
74. How does the system prevent a double-tapped button from posting twice? 💡 Client request IDs / idempotency keys.

## 8. Security

75. How do users log in? How are passwords stored? 💡 bcrypt hashing, never plain text.
76. What is a JWT? How does your session work?
77. What roles exist, and what can each do? 💡 Admin vs staff; `requireRole`.
78. What stops a staff user from opening admin pages by typing the URL? 💡 Checked on the server, not just hidden in the UI.
79. What is SQL injection? How do you prevent it? 💡 Parameterized queries (`?` placeholders).
80. What is rate limiting? What is Helmet? 💡 Brute-force protection; security headers.
81. What happens after many wrong PIN attempts? 💡 Escalating lockout.
82. How do you log out a user everywhere if their password changes? 💡 Token version.
83. Is the data safe if the computer breaks?
84. What audit trails exist? Who did what, and when?

## 9. Testing and quality

85. How did you test the system? 💡 About 30 automated test files, 174 tests; `npm test`.
86. What is the difference between unit, integration and user acceptance testing?
87. Show a test and explain what it checks.
88. What bugs did you find during testing, and how did you fix them? 💡 `docs/LOGICAL_AUDIT_AND_REMEDIATION_LOG.md`, `docs/FUTURE_PROOFING_AUDIT_TRACKER.md`.
89. How do you know the ledger always balances?

## 10. Live demo traps (panel may ask you to do these)

90. Add a new menu product with a recipe, then sell it, and show the stock and COGS change.
91. Void that order and show that stock and the ledger are corrected.
92. Record an expense and show where it appears (P&L, budget, cash).
93. Open and close a cashier shift with a cash shortage.
94. Log waste and show its cost.
95. Show the P&L and Balance Sheet, and prove Assets = Liabilities + Equity.
96. Log in as staff and try to open an admin page.
97. Change a setting (target food cost, VAT) and show its effect.

## 11. Limitations and future work

98. What are the limitations of your system?
99. Why is there no payroll yet? How would you add it? 💡 `docs/PAYROLL_IMPLEMENTATION_PLAN.md`.
100. Can it handle multiple branches? How would you scale it?
101. Can it go online or to the cloud? What would change?
102. What would you improve if you had more time?
103. What recommendations do you have for future researchers?

## 12. Personal and ethical

104. Who did what in your group?
105. Did you use AI tools? How did you make sure you understand the code? 💡 Be honest, and show you can explain every part.
106. How do you protect customer and employee personal data (Data Privacy Act of 2012)?
107. Did the client (owner) agree to the system? Is it being used?
108. What did you learn from this project?

---

**Study tip:** For each section, practice answering out loud in 30–60 seconds, then open the related file and check that your answer matches the code.
