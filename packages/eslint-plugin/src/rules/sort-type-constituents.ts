import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { createRule, getEnumNames, typeNodeRequiresParentheses } from '../util';

enum Group {
  conditional = 'conditional',
  function = 'function',
  import = 'import',
  intersection = 'intersection',
  keyword = 'keyword',
  nullish = 'nullish',
  literal = 'literal',
  named = 'named',
  object = 'object',
  operator = 'operator',
  tuple = 'tuple',
  union = 'union',
}

function getGroup(node: TSESTree.TypeNode): Group {
  switch (node.type) {
    case AST_NODE_TYPES.TSConditionalType:
      return Group.conditional;

    case AST_NODE_TYPES.TSConstructorType:
    case AST_NODE_TYPES.TSFunctionType:
      return Group.function;

    case AST_NODE_TYPES.TSImportType:
      return Group.import;

    case AST_NODE_TYPES.TSIntersectionType:
      return Group.intersection;

    case AST_NODE_TYPES.TSAnyKeyword:
    case AST_NODE_TYPES.TSBigIntKeyword:
    case AST_NODE_TYPES.TSBooleanKeyword:
    case AST_NODE_TYPES.TSNeverKeyword:
    case AST_NODE_TYPES.TSNumberKeyword:
    case AST_NODE_TYPES.TSObjectKeyword:
    case AST_NODE_TYPES.TSStringKeyword:
    case AST_NODE_TYPES.TSSymbolKeyword:
    case AST_NODE_TYPES.TSThisType:
    case AST_NODE_TYPES.TSUnknownKeyword:
    case AST_NODE_TYPES.TSIntrinsicKeyword:
      return Group.keyword;

    case AST_NODE_TYPES.TSNullKeyword:
    case AST_NODE_TYPES.TSUndefinedKeyword:
    case AST_NODE_TYPES.TSVoidKeyword:
      return Group.nullish;

    case AST_NODE_TYPES.TSLiteralType:
    case AST_NODE_TYPES.TSTemplateLiteralType:
      return Group.literal;

    case AST_NODE_TYPES.TSArrayType:
    case AST_NODE_TYPES.TSIndexedAccessType:
    case AST_NODE_TYPES.TSInferType:
    case AST_NODE_TYPES.TSTypeReference:
    case AST_NODE_TYPES.TSQualifiedName:
      return Group.named;

    case AST_NODE_TYPES.TSMappedType:
    case AST_NODE_TYPES.TSTypeLiteral:
      return Group.object;

    case AST_NODE_TYPES.TSTypeOperator:
    case AST_NODE_TYPES.TSTypeQuery:
      return Group.operator;

    case AST_NODE_TYPES.TSTupleType:
      return Group.tuple;

    case AST_NODE_TYPES.TSUnionType:
      return Group.union;

    // These types should never occur as part of a union/intersection
    case AST_NODE_TYPES.TSAbstractKeyword:
    case AST_NODE_TYPES.TSAsyncKeyword:
    case AST_NODE_TYPES.TSDeclareKeyword:
    case AST_NODE_TYPES.TSExportKeyword:
    case AST_NODE_TYPES.TSNamedTupleMember:
    case AST_NODE_TYPES.TSOptionalType:
    case AST_NODE_TYPES.TSPrivateKeyword:
    case AST_NODE_TYPES.TSProtectedKeyword:
    case AST_NODE_TYPES.TSPublicKeyword:
    case AST_NODE_TYPES.TSReadonlyKeyword:
    case AST_NODE_TYPES.TSRestType:
    case AST_NODE_TYPES.TSStaticKeyword:
    case AST_NODE_TYPES.TSTypePredicate:
      /* istanbul ignore next */
      throw new Error(`Unexpected Type ${node.type}`);
  }
}

export type Options = [
  {
    checkIntersections?: boolean;
    checkUnions?: boolean;
    groupOrder?: string[];
  },
];
export type MessageIds = 'notSorted' | 'notSortedNamed' | 'suggestFix';

export default createRule<Options, MessageIds>({
  name: 'sort-type-constituents',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce constituents of a type union/intersection to be sorted alphabetically',
    },
    fixable: 'code',
    hasSuggestions: true,
    messages: {
      notSorted: '{{type}} type constituents must be sorted.',
      notSortedNamed: '{{type}} type {{name}} constituents must be sorted.',
      suggestFix: 'Sort constituents of type (removes all comments).',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          checkIntersections: {
            description: 'Whether to check intersection types.',
            type: 'boolean',
          },
          checkUnions: {
            description: 'Whether to check union types.',
            type: 'boolean',
          },
          groupOrder: {
            description: 'Ordering of the groups.',
            type: 'array',
            items: {
              type: 'string',
              enum: getEnumNames(Group),
            },
          },
        },
      },
    ],
  },
  defaultOptions: [
    {
      checkIntersections: true,
      checkUnions: true,
      groupOrder: [
        Group.named,
        Group.keyword,
        Group.operator,
        Group.literal,
        Group.function,
        Group.import,
        Group.conditional,
        Group.object,
        Group.tuple,
        Group.intersection,
        Group.union,
        Group.nullish,
      ],
    },
  ],
  create(context, [{ checkIntersections, checkUnions, groupOrder }]) {
    const collator = new Intl.Collator('en', {
      sensitivity: 'base',
      numeric: true,
    });

    // Normalize source text for complex types to ignore formatting differences.
    function getSortText(
      type: TSESTree.TypeNode | TSESTree.TypeElement,
    ): string {
      if (type.type === AST_NODE_TYPES.TSTypeLiteral) {
        const properties = type.members
          .map(member => getSortText(member))
          .join('; ');

        return `{ ${properties} }`;
      }

      if (type.type === AST_NODE_TYPES.TSMappedType) {
        return `{ [${context.sourceCode.getText(type.typeParameter)}]: ${context.sourceCode.getText(type.typeAnnotation)}`;
      }

      if (type.type === AST_NODE_TYPES.TSTupleType) {
        const properties = type.elementTypes
          .map(elementType => getSortText(elementType))
          .join(', ');

        return `[${properties}]`;
      }

      if (type.type === AST_NODE_TYPES.TSFunctionType) {
        const params = type.params
          .map(param => context.sourceCode.getText(param))
          .join(', ');

        return `(${params}) => ${type.returnType ? getSortText(type.returnType.typeAnnotation) : 'void'}`;
      }

      return context.sourceCode.getText(type);
    }

    function checkSorting(
      node: TSESTree.TSIntersectionType | TSESTree.TSUnionType,
    ): void {
      const sourceOrder = node.types.map(type => {
        const group = groupOrder?.indexOf(getGroup(type)) ?? -1;
        return {
          group: group === -1 ? Number.MAX_SAFE_INTEGER : group,
          node: type,
          sortText: getSortText(type),
          text: context.sourceCode.getText(type),
        };
      });
      const expectedOrder = [...sourceOrder].sort((a, b) => {
        if (a.group !== b.group) {
          return a.group - b.group;
        }

        return (
          collator.compare(a.sortText, b.sortText) ||
          (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0)
        );
      });

      const hasComments = node.types.some(type => {
        const count =
          context.sourceCode.getCommentsBefore(type).length +
          context.sourceCode.getCommentsAfter(type).length;
        return count > 0;
      });

      for (let i = 0; i < expectedOrder.length; i += 1) {
        if (expectedOrder[i].node !== sourceOrder[i].node) {
          let messageId: MessageIds = 'notSorted';
          const data = {
            name: '',
            type:
              node.type === AST_NODE_TYPES.TSIntersectionType
                ? 'Intersection'
                : 'Union',
          };
          if (node.parent.type === AST_NODE_TYPES.TSTypeAliasDeclaration) {
            messageId = 'notSortedNamed';
            data.name = node.parent.id.name;
          }

          const fix: TSESLint.ReportFixFunction = fixer => {
            const sorted = expectedOrder
              .map(t =>
                typeNodeRequiresParentheses(t.node, t.text) ||
                (node.type === AST_NODE_TYPES.TSIntersectionType &&
                  t.node.type === AST_NODE_TYPES.TSUnionType)
                  ? `(${t.text})`
                  : t.text,
              )
              .join(
                node.type === AST_NODE_TYPES.TSIntersectionType ? ' & ' : ' | ',
              );

            return fixer.replaceText(node, sorted);
          };
          return context.report({
            node,
            messageId,
            data,
            // don't autofix if any of the types have leading/trailing comments
            // the logic for preserving them correctly is a pain - we may implement this later
            ...(hasComments
              ? {
                  suggest: [
                    {
                      messageId: 'suggestFix',
                      fix,
                    },
                  ],
                }
              : { fix }),
          });
        }
      }
    }

    return {
      ...(checkIntersections && {
        TSIntersectionType(node): void {
          checkSorting(node);
        },
      }),
      ...(checkUnions && {
        TSUnionType(node): void {
          checkSorting(node);
        },
      }),
    };
  },
});
