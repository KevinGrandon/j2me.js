module J2ME {

  export class Emitter {
    constructor(
      public writer: IndentingWriter,
      public closure: boolean,
      public debugInfo: boolean,
      public klassHeaderOnly: boolean = false,
      public definitions: boolean = false
    ) {
      // ...
    }
  }
  
  function getClassInheritanceChain(classInfo: ClassInfo): ClassInfo [] {
    var list = [];
    var klass = classInfo;
    while (klass) {
      list.unshift(klass);
      klass = klass.superClass;
    }
    return list;
  }

  function typeDescriptorToDefinition(value: string): string {
    var typeDescriptor = TypeDescriptor.parseTypeDescriptor(value, 0);
    var type = "";
    if (typeDescriptor.kind === Kind.Reference) {
      var dimensions = TypeDescriptor.getArrayDimensions(typeDescriptor);
      if (dimensions) {
        var elementType = typeDescriptor.value.substring(dimensions);
        var elementTypeDescriptor = TypeDescriptor.parseTypeDescriptor(elementType, 0);
        dimensions --;
        switch (elementTypeDescriptor.kind) {
          case Kind.Int:
            type = "Int32Array";
            break;
          case Kind.Char:
            type = "Uint16Array";
            break;
          case Kind.Short:
            type = "Int16Array";
            break;
          case Kind.Byte:
          case Kind.Boolean:
            type = "Int8Array";
            break;
          case Kind.Float:
            type = "Float32Array";
            break;
          case Kind.Long:
            type = "Array";
            break;
          case Kind.Double:
            type = "Float64Array";
            break;
          default:
            type = typeDescriptorToDefinition(elementType);
            dimensions ++;
            break;
        }
      } else {
        type = typeDescriptor.value.substring(dimensions + 1, typeDescriptor.value.length - 1);
        type = type.replace(/\//g, '.');
      }
      for (var i = 0; i < dimensions; i++) {
        type += "[]";
      }
    } else {
      switch (typeDescriptor.kind) {
        case Kind.Boolean: return "boolean";
        case Kind.Byte:
        case Kind.Short:
        case Kind.Char:
        case Kind.Int:
        case Kind.Float:
        case Kind.Double:
          return "number";
        case Kind.Long:
          return "number"; // Should be Long.
        case Kind.Void:
          return "void";
        default: throw Debug.unexpected("Unknown kind: " + typeDescriptor.kind);

      }
    }
    return type;
  }

  export function signatureToDefinition(signature: string, includeReturnType = true, excludeArgumentNames = false): string {
    var types = SignatureDescriptor.makeSignatureDescriptor(signature).typeDescriptors;
    var argumentNames = "abcdefghijklmnopqrstuvwxyz";
    var i = 0;
    var result;
    if (excludeArgumentNames) {
      result = "(" + types.slice(1).map(t => typeDescriptorToDefinition(t.value)).join(", ") + ")";
    } else {
      result = "(" + types.slice(1).map(t => argumentNames[i++] + ": " + typeDescriptorToDefinition(t.value)).join(", ") + ")";
    }
    J2ME.Debug.assert(i < argumentNames.length);
    if (includeReturnType) {
      result += " => " + typeDescriptorToDefinition(types[0].value);
    }
    return result;
  }


  export function emitMethodDefinition(emitter: Emitter, methodInfo: MethodInfo) {
    if (methodInfo.name === "<clinit>") {
      return;
    }
    if (methodInfo.isStatic && methodInfo.classInfo.isInterface) {
      return;
    }
    var isStaticString = methodInfo.isStatic ? "static " : "";
    var isConstructor = methodInfo.name === "<init>";
    if (isConstructor) {
      // emitter.writer.writeLn("constructor" + signatureToDefinition(methodInfo.signature, false) + " {}");
    } else {
      var name = methodInfo.name + methodInfo.signature;
      emitter.writer.writeLn(isStaticString + quote(name) + ": " + signatureToDefinition(methodInfo.signature) + ";");
    }
  }

  export function emitFieldDefinition(emitter: Emitter, fieldInfo: FieldInfo) {
    if (fieldInfo.isStatic && fieldInfo.classInfo.isInterface) {
      return;
    }
    var isStaticString = fieldInfo.isStatic ? "static " : "";
    emitter.writer.writeLn(isStaticString + fieldInfo.name + ": " + typeDescriptorToDefinition(fieldInfo.signature) + ";");
  }

  export function emitKlass(emitter: Emitter, classInfo: ClassInfo) {
    var writer = emitter.writer;
    var mangledClassName = mangleClass(classInfo);
    if (emitter.closure) {
      writer.writeLn("/** @constructor */");
    }

    function emitFields(fields: FieldInfo [], emitStatic: boolean) {
      for (var i = 0; i < fields.length; i++) {
        var fieldInfo = fields[i];
        if (fieldInfo.isStatic !== emitStatic) {
          continue;
        }
        var signature = TypeDescriptor.makeTypeDescriptor(fieldInfo.signature);
        var kind = signature.kind;
        var defaultValue;
        switch (kind) {
        case Kind.Reference:
          defaultValue = "null";
          break;
        case Kind.Long:
          defaultValue = "Long.ZERO";
          break;
        default:
          defaultValue = "0";
          break;
        }
        if (emitter.definitions) {
          emitFieldDefinition(emitter, fieldInfo);
        } else {
          if (emitter.closure) {
            writer.writeLn("this[" + quote(fieldInfo.mangledName) + "] = " + defaultValue + ";");
          } else {
            writer.writeLn("this." + fieldInfo.mangledName + " = " + defaultValue + ";");
          }
        }
      }
    }

    if (emitter.definitions) {
      emitFields(classInfo.fields, false);
      emitFields(classInfo.fields, true);
      return;
    }

    // Emit class initializer.
    writer.enter("function " + mangledClassName + "() {");
    //
    // Should we or should we not generate hash codes at this point? Eager or lazy, we should at least
    // initialize it zero to keep object shapes fixed.
    // writer.writeLn("this._hashCode = $.nextHashCode(this);");
    writer.writeLn("this._hashCode = 0;");
    getClassInheritanceChain(classInfo).forEach(function (ci) {
      emitFields(ci.fields, false);
    });
    writer.leave("}");

    // Emit class static initializer if it has any static fields. We don't emit this for now
    // since it probably doesn't pay off to emit code that only gets executed once.
    if (false && classInfo.fields.some(f => f.isStatic)) {
      writer.enter(mangledClassName + ".staticInitializer = function() {");
      emitFields(classInfo.fields, true);
      writer.leave("}");
    }

    if (emitter.klassHeaderOnly) {
      return;
    }

    if (emitter.closure) {
      writer.writeLn("window[" + quote(mangledClassName) + "] = " + mangledClassName + ";");
    }
  }

  function classNameWithDots(classInfo: ClassInfo) {
    return classInfo.className.replace(/\//g, '.');
  }

  export function emitReferencedSymbols(emitter: Emitter, classInfo: ClassInfo, compiledMethods: CompiledMethodInfo []) {
    var referencedClasses = [];
    for (var i = 0; i < compiledMethods.length; i++) {
      var compiledMethod = compiledMethods[i];
      compiledMethod.referencedClasses.forEach(classInfo => {
        ArrayUtilities.pushUnique(referencedClasses, classInfo);
      });
    }

    var mangledClassName = mangleClass(classInfo);

    emitter.writer.writeLn(mangledClassName + ".classSymbols = [" + referencedClasses.map(classInfo => {
      return quote(classInfo.className);
    }).join(", ") + "];");
  }

  function compileClassInfo(emitter: Emitter, classInfo: ClassInfo,
                            methodFilter: (methodInfo: MethodInfo) => boolean,
                            ctx: Context): CompiledMethodInfo [] {
    var writer = emitter.writer;
    var mangledClassName = mangleClass(classInfo);
    if (!J2ME.C4.Backend.isIdentifierName(mangledClassName)) {
      mangledClassName = quote(mangledClassName);
    }

    var classNameParts;
    if (emitter.definitions) {
      classNameParts = classInfo.className.split("/");
      if (classNameParts.length > 1) {
        writer.enter("module " + classNameParts.slice(0, classNameParts.length - 1).join(".") + " {");
      }
      var classOrInterfaceString = classInfo.isInterface ? "interface" : "class";
      var extendsString = classInfo.superClass ? " extends " + classNameWithDots(classInfo.superClass) : "";
      if (classInfo.isInterface) {
        extendsString = "";
      }
      // var implementsString = classInfo.interfaces.length ? " implements " + classInfo.interfaces.map(i => classNameWithDots(i)).join(", ") : "";
      var implementsString = "";
      writer.enter("export " + classOrInterfaceString + " " + classNameParts[classNameParts.length - 1] + extendsString + implementsString + " {");
    }

    emitKlass(emitter, classInfo);

    var methods = classInfo.methods;
    var compiledMethods: CompiledMethodInfo [] = [];
    for (var i = 0; i < methods.length; i++) {
      var method = methods[i];
      if (method.isNative) {
        continue;
      }
      if (!methodFilter(method)) {
        continue;
      }
      var mangledMethodName = mangleMethod(method);
      if (!J2ME.C4.Backend.isIdentifierName(mangledMethodName)) {
        mangledMethodName = quote(mangledMethodName);
      }
      if (emitter.definitions) {
        emitMethodDefinition(emitter, method);
        continue;
      }
      try {
        var mangledClassAndMethodName = mangleClassAndMethod(method);
        if (emitter.debugInfo) {
          writer.writeLn("// " + classInfo.className + "/" + method.name + " " + method.signature + " (" + mangledClassAndMethodName + ") " + method.getSourceLocationForPC(0));
        }
        var compiledMethod = undefined;
        try {
          compiledMethod = compileMethodInfo(method, ctx, CompilationTarget.Static);
        } catch (e) {
          writer.writeLn("// " + e.toString());
        }
        if (compiledMethod && compiledMethod.body) {
          var compiledMethodName = mangledClassAndMethodName;
          if (method.isSynchronized) {
            compiledMethodName = "_" + mangledClassAndMethodName + "_";
            // Emit Synchronization Wrapper
            var lockObject = method.isStatic ? "$." + mangleClass(method.classInfo) : "this";
            var me = "$ME(" + lockObject + "); if (U) return;"; // We may need to unwind after a monitorEnter.
            var mx = "$MX(" + lockObject + ");";
            writer.writeLn("// Synchronization Wrapper");
            writer.enter("function " + mangledClassAndMethodName + "(" + compiledMethod.args.join(",") + ") {");
            writer.enter("try {");
            writer.writeLn(me);
            if (method.isStatic) {
              writer.writeLn("var r = " + compiledMethodName + "(" + compiledMethod.args.join(",") + ");");
            } else {
              if (compiledMethod.args.length > 0) {
                writer.writeLn("var r = " + compiledMethodName + ".call(this, " + compiledMethod.args.join(",") + ");");
              } else {
                writer.writeLn("var r = " + compiledMethodName + ".call(this);");
              }
            }
            writer.writeLn(mx);
            writer.writeLn("return r;");
            writer.leave("} catch (e) { " + mx + " throw e; }");
            writer.leave("}");
          }
          writer.enter("function " + compiledMethodName + "(" + compiledMethod.args.join(",") + ") {");
          writer.writeLns(compiledMethod.body);
          writer.leave("}");
          if (method.name === "<clinit>") {
            writer.writeLn(mangledClassName + ".staticConstructor = " + mangledClassAndMethodName);
          } else if (!method.isStatic) {
            //if (emitter.closure) {
            //  writer.writeLn(mangledClassName + ".prototype[" + quote(mangledMethodName) + "] = " + mangledClassAndMethodName + ";");
            //} else {
            //  writer.writeLn(mangledClassName + ".prototype." + mangledMethodName + " = " + mangledClassAndMethodName + ";");
            //}
            if (emitter.closure) {
              writer.writeLn("window[" + quote(mangledClassAndMethodName) + "] = " + mangledClassAndMethodName + ";");
            }
          }
          compiledMethods.push(compiledMethod);
        }
      } catch (x) {
        stderrWriter.writeLn("XXXX: " + x);
        stderrWriter.writeLn(x.stack);
      }
    }

    emitReferencedSymbols(emitter, classInfo, compiledMethods);

    if (emitter.definitions) {
      if (classNameParts.length > 1) {
        writer.leave("}");
      }
      writer.leave("}");
    }

    return compiledMethods;
  }

  export function compile(jvm: any,
                          jarFilter: (jarFile: string) => boolean,
                          classFilter: (classInfo: ClassInfo) => boolean,
                          methodFilter: (methodInfo: MethodInfo) => boolean,
                          fileFilter: string, debugInfo: boolean, tsDefinitions: boolean) {
    var runtime = new Runtime(jvm);
    var jarFiles = CLASSES.jarFiles;
    var ctx = new Context(runtime);
    var code = "";
    var writer = new J2ME.IndentingWriter(false, function (s) {
      code += s + "\n";
    });

    var emitter = new Emitter(writer, false, debugInfo, false, tsDefinitions);

    var compiledMethods: CompiledMethodInfo [] = [];
    var classInfoList: ClassInfo [] = [];
    Object.keys(jarFiles).every(function (path) {
      if (path.substr(-4) !== ".jar" || !jarFilter(path)) {
        return true;
      }
      var zipFile = jarFiles[path];
      Object.keys(zipFile.directory).every(function (fileName) {
        if (fileName.substr(-6) !== '.class') {
          return true;
        }
        try {
          var className = fileName.substring(0, fileName.length - 6);
          var classInfo = CLASSES.getClass(className);
          if (classInfo.sourceFile && !classInfo.sourceFile.match(fileFilter)) {
            return true;
          }
          if (!classFilter(classInfo)) {
            return true;
          }
          classInfoList.push(classInfo);
        } catch (e) {
          stderrWriter.writeLn(e);
        }
        return true;
      }.bind(this));
      return true;
    }.bind(this));

    var orderedClassInfoList: ClassInfo [] = [];

    function hasDependencies(list, classInfo) {
      var superClass = classInfo.superClass;
      if (!superClass && classInfo.interfaces.length === 0) {
        return false;
      }
      for (var i = 0; i < list.length; i++) {
        if (list[i].className === superClass.className) {
          return true;
        }
      }

      for (var j = 0; j < classInfo.interfaces; j++) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].className === classInfo.interfaces[j].className) {
            return true;
          }
        }
      }

      return false;
    }
    while (classInfoList.length) {
      for (var i = 0; i < classInfoList.length; i++) {
        var classInfo = classInfoList[i];
        if (!hasDependencies(classInfoList, classInfo)) {
          orderedClassInfoList.push(classInfo);
          classInfoList.splice(i--, 1);
          break;
        }
      }
    }

    for (var i = 0; i < orderedClassInfoList.length; i++) {
      var classInfo = orderedClassInfoList[i];
      if (emitter.debugInfo) {
        writer.writeLn("// " + classInfo.className + (classInfo.superClass ? " extends " + classInfo.superClass.className : ""));
      }
      // Don't compile interfaces.
      if (classInfo.isInterface) {
        continue;
      }
      ArrayUtilities.pushMany(compiledMethods, compileClassInfo(emitter, classInfo, methodFilter, ctx));
    }

    stdoutWriter.writeLn(code);
  }
}


































