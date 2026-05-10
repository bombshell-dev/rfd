import type {} from "@atcute/lexicons";
import * as v from "@atcute/lexicons/validations";
import type {} from "@atcute/lexicons/ambient";

const _mainSchema = /*#__PURE__*/ v.record(
  /*#__PURE__*/ v.literal("self"),
  /*#__PURE__*/ v.object({
    $type: /*#__PURE__*/ v.literal("st.itch.discussion.repo"),
    createdAt: /*#__PURE__*/ v.datetimeString(),
    /**
     * AT-URI of the sh.tangled.repo record this user is claiming as their RFD discussion repo.
     */
    repo: /*#__PURE__*/ v.resourceUriString(),
  }),
);

type main$schematype = typeof _mainSchema;

export interface mainSchema extends main$schematype {}

export const mainSchema = _mainSchema as mainSchema;

export interface Main extends v.InferInput<typeof mainSchema> {}

declare module "@atcute/lexicons/ambient" {
  interface Records {
    "st.itch.discussion.repo": mainSchema;
  }
}
