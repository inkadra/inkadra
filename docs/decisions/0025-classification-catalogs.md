# Instance classification catalogs

Project types and card/frame tags are shared instance configuration. Administrators manage ordered values in Settings → Classifications; any authenticated account can read them. Templates, permission roles, board/card kinds, production workflow states and technical camera/shot presets remain separate contracts, not arbitrary classification fields.

The existing instance_setting JSONB table stores one versioned `classifications` document. Missing configuration supplies the five existing project types and an empty managed tag catalog. Saving requires the current revision and the administration advisory lock; removed identifiers and changed legacy bindings are rejected. Values are retired by archiving and can be restored. Type references already use a PostgreSQL text column, so no data migration is necessary.

Project type values are stable IDs, including the original built-in IDs. Project creation and changes require an active catalog value; unchanged retired values and clearing a type remain valid. Renaming does not update project rows.

New tags use UUID IDs in the existing Yjs tag string array. Each managed tag captures its original normalized name in an immutable `legacy` binding. Existing documents and search indexes using that text resolve to the same option after rename or archival. No document rewrite is needed. Unknown historic tags remain readable and searchable. New selections in the web tag editor use active managed values; imports, existing/offline clients and the clipper remain compatible with legacy free-text tags. Adding an option with the original tag name adopts those old values; its UUID and original binding cannot later be reused. Search checks both IDs and original bindings and resolves current labels.

Catalog changes refresh consumers immediately in the editing tab and on window focus/mount elsewhere. No live cross-client settings broadcast is introduced. The server remains authoritative for project type selection. Classification catalogs carry shared names only; they never scan or disclose tags from private project documents.
