# Catalog compatibility fixture provenance

`catalog-v5-61a4659.sqlite.gz.b64` is a gzip-compressed, base64-encoded SQLite
image created by `ProjectCatalog` from OpenFilm commit
`61a46596d7a2cd17e1c993b2b6fd3f31c5ed807d`, where
`CATALOG_SCHEMA_VERSION` is 5. It is not a current database with later tables
removed.

The fixture contains one synthetic image asset (`legacy-asset`) and no private
media, credentials or user data. The uncompressed image is 172,032 bytes and its
SHA-256 is
`11d5b3ac7d4093c59b329cd6a4840a9a2dacf62872bd776c01a3cb6d459d4a2d`.
Tests pin that digest before using the image for inspect, migration, diff,
restore and checkpoint coverage.
