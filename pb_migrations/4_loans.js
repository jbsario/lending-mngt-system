/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const borrowers = app.findCollectionByNameOrId("borrowers");
  const groups = app.findCollectionByNameOrId("borrower_groups");

  const collection = new Collection({
    name: "loans",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      { name: "loan_number", type: "text", required: true },
      { name: "borrower", type: "relation", collectionId: borrowers.id, maxSelect: 1 },
      { name: "group", type: "relation", collectionId: groups.id, maxSelect: 1 },
      { name: "principal_amount", type: "number", required: true },
      { name: "interest_rate", type: "number", required: true },
      {
        name: "interest_method",
        type: "select",
        maxSelect: 1,
        values: ["flat", "declining"]
      },
      { name: "term_months", type: "number", required: true },
      {
        name: "repayment_frequency",
        type: "select",
        maxSelect: 1,
        values: ["weekly", "biweekly", "monthly"]
      },
      { name: "disbursement_date", type: "date" },
      { name: "purpose", type: "text" },
      {
        name: "status",
        type: "select",
        maxSelect: 1,
        values: ["pending", "active", "completed", "defaulted", "written_off"]
      },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_loans_loan_number ON loans (loan_number)"
    ]
  });
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("loans");
  return app.delete(collection);
});
