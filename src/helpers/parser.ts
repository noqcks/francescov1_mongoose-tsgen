import mongoose from "mongoose";
import flatten, { unflatten } from "flat";
import glob from "glob";
import path from "path";
import * as fs from "fs";
import _ from "lodash";
import stripJsonComments from "strip-json-comments";
import { Project, SourceFile, SyntaxKind } from "ts-morph";

const MAIN_HEADER = `/* tslint:disable */\n/* eslint-disable */\n\n// ######################################## THIS FILE WAS GENERATED BY MONGOOSE-TSGEN ######################################## //\n\n// NOTE: ANY CHANGES MADE WILL BE OVERWRITTEN ON SUBSEQUENT EXECUTIONS OF MONGOOSE-TSGEN.`;
const IMPORTS = `import mongoose from "mongoose";`;

const getObjectDocs = (modelName: string) => `/**
 * Lean version of ${modelName}Document (type alias of \`${modelName}\`)
 * 
 * Use this type alias to avoid conflicts with model names:
 * \`\`\`
 * import { ${modelName} } from "../models"
 * import { ${modelName}Object } from "../interfaces/mongoose.gen.ts"
 * 
 * const ${modelName.toLowerCase()}Object: ${modelName}Object = ${modelName.toLowerCase()}.toObject();
 * \`\`\`
 */`;

const getQueryDocs = (modelName: string) => `/**
 * Mongoose Query types
 * 
 * Pass this type to the Mongoose Model constructor:
 * \`\`\`
 * const ${modelName} = mongoose.model<${modelName}Document, ${modelName}Model, ${modelName}Queries>("${modelName}", ${modelName}Schema);
 * \`\`\`
 */`;

const getModelDocs = (modelName: string) => `/**
 * Mongoose Model type
 * 
 * Pass this type to the Mongoose Model constructor:
 * \`\`\`
 * const ${modelName} = mongoose.model<${modelName}Document, ${modelName}Model, ${modelName}Queries>("${modelName}", ${modelName}Schema);
 * \`\`\`
 */`;

const getDocumentDocs = (modelName: string) => `/**
 * Mongoose Document type
 * 
 * Pass this type to the Mongoose Model constructor:
 * \`\`\`
 * const ${modelName} = mongoose.model<${modelName}Document, ${modelName}Model, ${modelName}Queries>("${modelName}", ${modelName}Schema);
 * \`\`\`
 */`;

const getSchemaDocs = (modelName: string) => `/**
 * Mongoose Schema type
 * 
 * Assign this type to new ${modelName} schema instances:
 * \`\`\`
 * const ${modelName}Schema: ${modelName}Schema = new mongoose.Schema({ ... })
 * \`\`\`
 */`;

// If model is a subdoc, pass `fullName`
const getLeanDocs = (modelName: string, fullName?: string) => `/**
 * Lean version of ${fullName ?? modelName}Document
 * 
 * This has all Mongoose getters & functions removed. This type will be returned from \`${modelName}Document.toObject()\`.${
  !fullName || modelName === fullName ?
    ` To avoid conflicts with model names, use the type alias \`${modelName}Object\`.` :
    ""
}
 * \`\`\`
 * const ${modelName.toLowerCase()}Object = ${modelName.toLowerCase()}.toObject();
 * \`\`\`
 */`;

const getSubdocumentDocs = (modelName: string, path: string) => `/**
 * Mongoose Embedded Document type
 * 
 * Type of \`${modelName}Document["${path}"]\` element.
 */`;

// TODO: simplify this conditional
const shouldLeanIncludeVirtuals = (schema: any) => {
  // Check the toObject options to determine if virtual property should be included.
  // See https://mongoosejs.com/docs/api.html#document_Document-toObject for toObject option documentation.
  const toObjectOptions = schema.options?.toObject ?? {};
  if (
    (!toObjectOptions.virtuals && !toObjectOptions.getters) ||
    (toObjectOptions.virtuals === false && toObjectOptions.getters === true)
  )
    return false;
  return true;
};

const makeLine = ({
  key,
  val,
  isOptional = false,
  newline = true
}: {
  key: string;
  val: string;
  isOptional?: boolean;
  newline?: boolean;
}) => {
  let line = "";

  if (key) {
    line += key;
    if (isOptional) line += "?";
    line += ": ";
  }
  line += val + ";";
  if (newline) line += "\n";
  return line;
};

const getFuncType = (
  funcSignature: string,
  funcType: "methods" | "statics" | "query",
  modelName: string
) => {
  const [, params, returnType] = funcSignature.match(/\((?:this: \w*(?:, )?)?(.*)\) => (.*)/) ?? [];
  let type;
  if (funcType === "query") {
    // query funcs always must return a query
    type = `<Q extends mongoose.Query<any, ${modelName}Document, any>>(this: Q${
      params?.length > 0 ? ", " + params : ""
    }) => Q`;
  } else if (funcType === "methods") {
    type = `(this: ${modelName}Document${params?.length > 0 ? ", " + params : ""}) => ${
      returnType ?? "any"
    }`;
  } else {
    type = `(this: ${modelName}Model${params?.length > 0 ? ", " + params : ""}) => ${
      returnType ?? "any"
    }`;
  }
  return type;
};

type ModelTypes = {
  [modelName: string]: {
    methods: { [funcName: string]: string };
    statics: { [funcName: string]: string };
    query: { [funcName: string]: string };
    virtuals: { [virtualName: string]: string };
    schemaVariableName?: string;
    modelVariableName?: string;
    filePath: string;
  };
};

export const replaceModelTypes = (
  sourceFile: SourceFile,
  modelTypes: ModelTypes,
  schemas: LoadedSchemas
) => {
  Object.entries(modelTypes).forEach(([modelName, types]) => {
    const { methods, statics, query, virtuals } = types;

    // methods
    if (Object.keys(methods).length > 0) {
      sourceFile
        ?.getTypeAlias(`${modelName}Methods`)
        ?.getFirstChildByKind(SyntaxKind.TypeLiteral)
        ?.getChildrenOfKind(SyntaxKind.PropertySignature)
        .forEach(prop => {
          const newType = methods[prop.getName()];
          if (newType) {
            const funcType = getFuncType(newType, "methods", modelName);
            prop.setType(funcType);
          }
        });
    }

    // statics
    if (Object.keys(statics).length > 0) {
      sourceFile
        ?.getTypeAlias(`${modelName}Statics`)
        ?.getFirstChildByKind(SyntaxKind.TypeLiteral)
        ?.getChildrenOfKind(SyntaxKind.PropertySignature)
        .forEach(prop => {
          const newType = statics[prop.getName()];
          if (newType) {
            const funcType = getFuncType(newType, "statics", modelName);
            prop.setType(funcType);
          }
        });
    }

    // queries
    if (Object.keys(query).length > 0) {
      sourceFile
        ?.getTypeAlias(`${modelName}Queries`)
        ?.getFirstChildByKind(SyntaxKind.TypeLiteral)
        ?.getChildrenOfKind(SyntaxKind.PropertySignature)
        .forEach(prop => {
          const newType = query[prop.getName()];
          if (newType) {
            const funcType = getFuncType(newType, "query", modelName);
            prop.setType(funcType);
          }
        });
    }

    // virtuals
    if (Object.keys(virtuals).length > 0) {
      sourceFile
        ?.getInterface(`${modelName}Document`)
        ?.getChildrenOfKind(SyntaxKind.PropertySignature)
        .forEach(prop => {
          const newType = virtuals[prop.getName()];
          if (newType) prop.setType(newType);
        });

      // if toObject options indicate to include virtuals in lean, then also change types for lean doc
      if (shouldLeanIncludeVirtuals(schemas[modelName])) {
        sourceFile
          ?.getInterface(`${modelName}`)
          ?.getChildrenOfKind(SyntaxKind.PropertySignature)
          .forEach(prop => {
            const newType = virtuals[prop.getName()];
            if (newType) prop.setType(newType);
          });
      }
    }
  });
};

const getSubDocName = (path: string, modelName = "") => {
  let subDocName =
    modelName +
    path
      .split(".")
      .map((p: string) => p[0].toUpperCase() + p.slice(1))
      .join("");

  if (subDocName.endsWith("s")) subDocName = subDocName.slice(0, -1);
  return subDocName;
};

const parseFunctions = (
  funcs: any,
  modelName: string,
  funcType: "methods" | "statics" | "query"
) => {
  let interfaceString = "";

  Object.keys(funcs).forEach(key => {
    if (["initializeTimestamps"].includes(key)) return;

    const funcSignature = "(...args: any[]) => any";
    const type = getFuncType(funcSignature, funcType, modelName);
    interfaceString += makeLine({ key, val: type });
  });

  return interfaceString;
};

const convertBaseTypeToTs = (key: string, val: any, isDocument: boolean) => {
  let valType: string | undefined;
  // NOTE: ideally we check actual type of value to ensure its Schema.Types.Mixed (the same way we do with Schema.Types.ObjectId),
  // but this doesnt seem to work for some reason
  // {} is treated as Mixed
  if (
    val.schemaName === "Mixed" ||
    val.type?.schemaName === "Mixed" ||
    (val.constructor === Object && _.isEmpty(val)) ||
    (val.type?.constructor === Object && _.isEmpty(val.type))
  ) {
    valType = "any";
  } else {
    const mongooseType = val.type === Map ? val.of : val.type;
    switch (mongooseType) {
      case String:
      case "String":
        if (val.enum?.length > 0) {
          valType = `"` + val.enum.join(`" | "`) + `"`;
        } else valType = "string";
        break;
      case Number:
      case "Number":
        if (key !== "__v") valType = "number";
        break;
      case mongoose.Schema.Types.Decimal128:
      case mongoose.Types.Decimal128:
        valType = isDocument ? "mongoose.Types.Decimal128" : "number";
        break;
      case Boolean:
        valType = "boolean";
        break;
      case Date:
        valType = "Date";
        break;
      case Buffer:
      case "Buffer":
        valType = "Buffer";
        break;
      case mongoose.Schema.Types.ObjectId:
      case mongoose.Types.ObjectId:
      case "ObjectId": // _id fields have type set to the string "ObjectId"
        valType = "mongoose.Types.ObjectId";
        break;
      case Object:
        valType = "any";
        break;
      default:
        // this indicates to the parent func that this type is nested and we need to traverse one level deeper
        valType = "{}";
        break;
    }
  }

  return valType;
};

export const parseSchema = ({
  schema: schemaOriginal,
  modelName,
  addModel = false,
  isDocument,
  header = "",
  footer = ""
}: {
  schema: any;
  modelName?: string;
  addModel?: boolean;
  isDocument: boolean;
  header?: string;
  footer?: string;
}) => {
  let template = "";
  const schema = _.cloneDeep(schemaOriginal);

  if (schema.childSchemas?.length > 0 && modelName) {
    const flatSchemaTree: any = flatten(schema.tree, { safe: true });
    let childInterfaces = "";

    const processChild = (rootPath: string) => {
      return (child: any) => {
        const path = child.model.path;
        const isSubdocArray = child.model.$isArraySubdocument;
        const name = getSubDocName(path, rootPath);

        child.schema._isReplacedWithSchema = true;
        child.schema._inferredInterfaceName = name;
        child.schema._isSubdocArray = isSubdocArray;

        /**
         * for subdocument arrays, mongoose supports passing `default: undefined` to disable the default empty array created.
         * here we indicate this on the child schema using _isDefaultSetToUndefined so that the parser properly sets the `isOptional` flag
         */
        if (isSubdocArray) {
          const defaultValuePath = `${path}.default`;
          if (
            defaultValuePath in flatSchemaTree &&
            flatSchemaTree[defaultValuePath] === undefined
          ) {
            child.schema._isDefaultSetToUndefined = true;
          }
        }
        flatSchemaTree[path] = isSubdocArray ? [child.schema] : child.schema;

        // since we now will process this child by using the schema, we can remove any further nested properties in flatSchemaTree
        for (const key in flatSchemaTree) {
          if (key.startsWith(path) && key.length > path.length) {
            delete flatSchemaTree[key];
          }
        }

        let header = "";
        if (isDocument)
          header += isSubdocArray ? getSubdocumentDocs(rootPath, path) : getDocumentDocs(rootPath);
        else header += getLeanDocs(rootPath, name);

        header += "\nexport ";

        if (isDocument) {
          header += `interface ${name}Document extends `;
          if (isSubdocArray) {
            header += "mongoose.Types.EmbeddedDocument";
          }
          // not sure why schema doesnt have `tree` property for typings
          else {
            let _idType;
            // get type of _id to pass to mongoose.Document
            // this is likely unecessary, since non-subdocs are not allowed to have option _id: false (https://mongoosejs.com/docs/guide.html#_id)
            if ((schema as any).tree._id)
              _idType = convertBaseTypeToTs("_id", (schema as any).tree._id, true);

            // TODO: this should extend `${name}Methods` like normal docs, but generator will only have methods, statics, etc. under the model name, not the subdoc model name
            // so after this is generated, we should do a pass and see if there are any child schemas that have non-subdoc definitions.
            // or could just wait until we dont need duplicate subdoc versions of docs (use the same one for both embedded doc and non-subdoc)
            header += `mongoose.Document<${_idType ?? "never"}>`;
          }

          header += " {\n";
        } else header += `interface ${name} {\n`;

        childInterfaces += parseSchema({
          schema: child.schema,
          modelName: name,
          header,
          isDocument,
          footer: `}\n\n`
        });
      };
    };

    schema.childSchemas.forEach(processChild(modelName));

    const schemaTree = unflatten(flatSchemaTree);
    schema.tree = schemaTree;
    template += childInterfaces;
  }

  if (!isDocument && schema.statics && modelName && addModel) {
    // add type alias to modelName so that it can be imported without clashing with the mongoose model
    template += getObjectDocs(modelName);
    template += `\nexport type ${modelName}Object = ${modelName}\n`;

    template += getQueryDocs(modelName);
    template += `\nexport type ${modelName}Queries = {\n`;
    template += parseFunctions(schema.query ?? {}, modelName, "query");
    template += "}\n";

    template += `\nexport type ${modelName}Methods = {\n`;
    template += parseFunctions(schema.methods, modelName, "methods");
    template += "}\n";

    template += `\nexport type ${modelName}Statics = {\n`;
    template += parseFunctions(schema.statics, modelName, "statics");
    template += "}\n\n";

    const modelExtend = `mongoose.Model<${modelName}Document, ${modelName}Queries>`;

    template += getModelDocs(modelName);
    template += `\nexport interface ${modelName}Model extends ${modelExtend}, ${modelName}Statics {}\n\n`;

    template += getSchemaDocs(modelName);
    template += `\nexport type ${modelName}Schema = mongoose.Schema<${modelName}Document, ${modelName}Model>\n\n`;
  }

  template += header;

  const schemaTree = schema.tree;

  // parseSchema and getParseKeyFn call each other - both are exported consts
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const parseKey = getParseKeyFn(isDocument, schema);

  Object.keys(schemaTree).forEach((key: string) => {
    const val = schemaTree[key];
    template += parseKey(key, val);
  });

  template += footer;

  return template;
};

export const getParseKeyFn = (isDocument: boolean, schema: any) => {
  return (key: string, valOriginal: any): string => {
    // if the value is an object, we need to deepClone it to ensure changes to `val` aren't persisted in parent function
    let val = _.isPlainObject(valOriginal) ? _.cloneDeep(valOriginal) : valOriginal;

    let valType;
    let isOptional = !val.required;

    let isArray = Array.isArray(val);
    let isUntypedArray = false;
    /**
     * If _isDefaultSetToUndefined is set, it means this is a subdoc array with `default: undefined`, indicating that mongoose will not automatically
     * assign an empty array to the value. Therefore, isOptional = true. In other cases, isOptional is false since the field will be automatically initialized
     * with an empty array
     */
    const isArrayOuterDefaultSetToUndefined = Boolean(val._isDefaultSetToUndefined);

    // this means its a subdoc
    if (isArray) {
      val = val[0];
      if (val === undefined && val?.type === undefined) {
        isUntypedArray = true;
        isOptional = isArrayOuterDefaultSetToUndefined ?? false;
      } else {
        isOptional = val._isDefaultSetToUndefined ?? false;
      }
    } else if (Array.isArray(val.type)) {
      val.type = val.type[0];
      isArray = true;

      if (val.type === undefined) {
        isUntypedArray = true;
        isOptional = isArrayOuterDefaultSetToUndefined ?? false;
      } else if (val.type.type) {
        /**
         * Arrays can also take the following format.
         * This is used when validation needs to be done on both the element itself and the full array.
         * This format implies `required: true`.
         *
         * ```
         * friends: {
         *   type: [
         *     {
         *       type: Schema.Types.ObjectId,
         *       ref: "User",
         *       validate: [
         *         function(userId: mongoose.Types.ObjectId) { return !this.friends.includes(userId); }
         *       ]
         *     }
         *   ],
         *   validate: [function(val) { return val.length <= 3; } ]
         * }
         * ```
         */
        if (val.type.ref) val.ref = val.type.ref;
        val.type = val.type.type;
        isOptional = false;
      } else {
        // 2dsphere index is a special edge case which does not have an inherent default value of []
        isOptional = val.index === "2dsphere" ? true : isArrayOuterDefaultSetToUndefined;
      }
    }

    // if type is provided directly on property, expand it
    if (
      [
        Object,
        String,
        "String",
        Number,
        "Number",
        Boolean,
        Date,
        Buffer,
        "Buffer",
        mongoose.Schema.Types.ObjectId,
        mongoose.Types.ObjectId,
        mongoose.Types.Decimal128,
        mongoose.Schema.Types.Decimal128
      ].includes(val)
    )
      val = { type: val };

    const isMap = val?.type === Map;

    if (val === Array || val?.type === Array || isUntypedArray) {
      // treat Array constructor and [] as an Array<Mixed>
      isArray = true;
      valType = "any";
      isOptional = isArrayOuterDefaultSetToUndefined ?? false;
    } else if (val._inferredInterfaceName) {
      valType = val._inferredInterfaceName + (isDocument ? "Document" : "");
    } else if (val.path && val.path && val.setters && val.getters) {
      // check for virtual properties
      // skip id property
      if (key === "id") return "";

      // if not lean doc and lean docs shouldnt include virtuals, ignore entry
      if (!isDocument && !shouldLeanIncludeVirtuals(schema)) return "";

      valType = "any";
      isOptional = false;
    } else if (
      key &&
      [
        "get",
        "set",
        "schemaName",
        "defaultOptions",
        "_checkRequired",
        "_cast",
        "checkRequired",
        "cast",
        "__v"
      ].includes(key)
    ) {
      return "";
    } else if (val.ref) {
      let docRef: string;

      docRef = val.ref.replace(`'`, "");
      if (docRef.includes(".")) {
        docRef = getSubDocName(docRef);
      }

      valType = isDocument ?
        `${docRef}Document["_id"] | ${docRef}Document` :
        `${docRef}["_id"] | ${docRef}`;
    } else {
      // _ids are always required
      if (key === "_id") isOptional = false;
      const convertedType = convertBaseTypeToTs(key, val, isDocument);

      if (convertedType === "{}") {
        // if we dont find it, go one level deeper
        // here we pass isNestedObject: true to prevent `export ` from being prepended to the header
        valType = parseSchema({
          schema: { tree: val },
          header: "{\n",
          isDocument,
          footer: "}"
        });

        isOptional = false;
      } else {
        valType = convertedType;
      }
    }

    if (!valType) return "";

    if (isMap) valType = isDocument ? `mongoose.Types.Map<${valType}>` : `Map<string, ${valType}>`;

    if (valType === "Buffer" && isDocument) valType = "mongoose.Types.Buffer";

    if (isArray) {
      if (isDocument)
        valType = `mongoose.Types.${val._isSubdocArray ? "Document" : ""}Array<` + valType + ">";
      else {
        // if valType includes a space, likely means its a union type (ie "number | string") so lets wrap it in brackets when adding the array to the type
        if (valType.includes(" ")) valType = `(${valType})`;
        valType = `${valType}[]`;
      }
    }

    return makeLine({ key, val: valType, isOptional });
  };
};

export const registerUserTs = (basePath: string): (() => void) | null => {
  let pathToSearch: string;
  if (basePath.endsWith(".json")) pathToSearch = basePath;
  else pathToSearch = path.join(basePath, "**/tsconfig.json");

  const files = glob.sync(pathToSearch, { ignore: "**/node_modules/**" });

  if (files.length === 0) throw new Error(`No tsconfig.json file found at path "${basePath}"`);
  else if (files.length > 1)
    throw new Error(
      `Multiple tsconfig.json files found. Please specify a more specific --project value.\nPaths found: ${files}`
    );

  const foundPath = path.join(process.cwd(), files[0]);
  require("ts-node").register({ transpileOnly: true, project: foundPath });

  // handle path aliases
  const tsConfigString = fs.readFileSync(foundPath, "utf8");
  const tsConfig = JSON.parse(stripJsonComments(tsConfigString));
  if (tsConfig?.compilerOptions?.paths) {
    const cleanup = require("tsconfig-paths").register({
      baseUrl: process.cwd(),
      paths: tsConfig.compilerOptions.paths
    });

    return cleanup;
  }

  return null;
};

interface LoadedSchemas {
  [modelName: string]: mongoose.Schema;
}

export const loadSchemas = (modelsPaths: string[]) => {
  const schemas: LoadedSchemas = {};

  const checkAndRegisterModel = (obj: any): boolean => {
    if (!obj?.modelName || !obj?.schema) return false;
    schemas[obj.modelName] = obj.schema;
    return true;
  };

  modelsPaths.forEach((singleModelPath: string) => {
    let exportedData;
    try {
      exportedData = require(singleModelPath);
    } catch (err) {
      if (err.message?.includes(`Cannot find module '${singleModelPath}'`))
        throw new Error(`Could not find a module at path ${singleModelPath}.`);
      else throw err;
    }

    const prevSchemaCount = Object.keys(schemas).length;

    // NOTE: This was used to find the most likely names of the model based on the filename, and only check those properties for mongoose models. Now, we check all properties, but this could be used as a "strict" option down the road.

    // we check each file's export object for property names that would commonly export the schema.
    // Here is the priority (using the filename as a starting point to determine model name):
    // default export, model name (ie `User`), model name lowercase (ie `user`), collection name (ie `users`), collection name uppercased (ie `Users`).
    // If none of those exist, we assume the export object is set to the schema directly
    /*
    // if exported data has a default export, use that
    if (checkAndRegisterModel(exportedData.default) || checkAndRegisterModel(exportedData)) return;

    // if no default export, look for a property matching file name
    const { name: filenameRoot } = path.parse(singleModelPath);

    // capitalize first char
    const modelName = filenameRoot.charAt(0).toUpperCase() + filenameRoot.slice(1);
    const collectionNameUppercased = modelName + "s";

    let modelNameLowercase = filenameRoot.endsWith("s") ? filenameRoot.slice(0, -1) : filenameRoot;
    modelNameLowercase = modelNameLowercase.toLowerCase();

    const collectionName = modelNameLowercase + "s";

    // check likely names that schema would be exported from
    if (
      checkAndRegisterModel(exportedData[modelName]) ||
      checkAndRegisterModel(exportedData[modelNameLowercase]) ||
      checkAndRegisterModel(exportedData[collectionName]) ||
      checkAndRegisterModel(exportedData[collectionNameUppercased])
    )
      return;
    */

    // check if exported object is a model
    checkAndRegisterModel(exportedData);

    // iterate through each exported property, check if val is a schema and add to schemas if so
    for (const obj of Object.values(exportedData)) {
      checkAndRegisterModel(obj);
    }

    const schemaCount = Object.keys(schemas).length - prevSchemaCount;
    if (schemaCount === 0) {
      console.warn(
        `A module was found at ${singleModelPath}, but no exported models were found. Please ensure this file exports a Mongoose Model (preferably default export).`
      );
    }
  });

  return schemas;
};

export const createSourceFile = (genPath: string) => {
  const project = new Project();
  const sourceFile = project.createSourceFile(genPath, "", { overwrite: true });
  return sourceFile;
};

export const generateTypes = ({
  sourceFile,
  schemas,
  imports = []
}: {
  sourceFile: SourceFile;
  schemas: LoadedSchemas;
  imports?: string[];
}) => {
  sourceFile.addStatements(writer => {
    writer.write(MAIN_HEADER).blankLine();
    // default imports
    writer.write(IMPORTS);
    // custom, user-defined imports
    if (imports.length > 0) writer.write(imports.join("\n"));

    writer.blankLine();
    // writer.write("if (true)").block(() => {
    //     writer.write("something;");
    // });

    Object.keys(schemas).forEach(modelName => {
      const schema = schemas[modelName];

      // passing modelName causes childSchemas to be processed
      const leanInterfaceStr = parseSchema({
        schema,
        modelName,
        addModel: true,
        isDocument: false,
        header: getLeanDocs(modelName) + `\nexport interface ${modelName} {\n`,
        footer: "}"
      });

      writer.write(leanInterfaceStr).blankLine();

      // get type of _id to pass to mongoose.Document
      // not sure why schema doesnt have `tree` property for typings
      let _idType;
      if ((schema as any).tree._id) {
        _idType = convertBaseTypeToTs("_id", (schema as any).tree._id, true);
      }

      const mongooseDocExtend = `mongoose.Document<${_idType ?? "never"}, ${modelName}Queries>`;

      const documentInterfaceStr = parseSchema({
        schema,
        modelName,
        addModel: true,
        isDocument: true,
        header:
          getDocumentDocs(modelName) +
          `\nexport interface ${modelName}Document extends ${mongooseDocExtend}, ${modelName}Methods {\n`,
        footer: "}"
      });

      writer.write(documentInterfaceStr).blankLine();
    });
  });

  return sourceFile;
};

export const saveFile = ({ sourceFile }: { sourceFile: SourceFile; genFilePath: string }) => {
  try {
    sourceFile.saveSync();
    // fs.writeFileSync(genFilePath, sourceFile.getFullText(), "utf8");
  } catch (err) {
    // if folder doesnt exist, create and then write again
    // if (err.message.includes("ENOENT: no such file or directory")) {
    //   console.log(`Path ${genFilePath} not found; creating...`);

    //   const { dir } = path.parse(genFilePath);
    //   mkdirp.sync(dir);

    //   fs.writeFileSync(genFilePath, sourceFile.getFullText(), "utf8");
    // }
    console.error(err);
    throw err;
  }
};
