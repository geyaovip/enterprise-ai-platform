# Tabulated harness and wire lists

- Treat wire name, wire specification/gauge, connector and terminal as distinct columns. In the caller's schema, `name` takes the wire-name column and `spec` takes only the wire-specification column. Do not concatenate connector or terminal cells into `spec`; retain unmapped information in an uncertainty note if the schema lacks those keys.
- A wire gauge, connector designation or terminal designation is not automatically a manufacturer's part number or an internal material code. Preserve what the source actually labels.
- Keep each row's name, colour, specification and quantity associated with that row. Similar names in adjacent rows do not justify merging them.
- A region/body-position column is not an explicit parent assembly identifier. Overlapping worksheets are separate source views until a human confirms whether to combine or exclude them.
