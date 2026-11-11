import ExpoModulesCore
import NaturalLanguage
import SwiftUI
import UIKit
import Vision
#if canImport(Translation)
import Translation
#endif

/// Text recognition, language detection and offline translation that run on the device.
public class OnDeviceLanguageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OnDeviceLanguage")

    // Apple's Translation framework needs iOS 18 for the APIs we use.
    Function("isTranslationAvailable") { () -> Bool in
      if #available(iOS 18.0, *) { return true }
      return false
    }

    // Reads the text in an image. Returns one entry per line, with a normalized
    // bounding box (0...1, origin top-left) so JS can rebuild paragraphs.
    AsyncFunction("recognizeText") { (uri: String, languages: [String]) async throws -> [[String: Any]] in
      let loaded = try loadImage(uri)
      let lines = try await Task.detached(priority: .userInitiated) {
        try recognize(cgImage: loaded.image, orientation: loaded.orientation, languages: languages)
      }.value
      return lines.map { ["text": $0.text, "x": $0.x, "y": $0.y, "width": $0.width, "height": $0.height] }
    }

    AsyncFunction("detectLanguage") { (text: String) -> [String: Any]? in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      guard let best = recognizer.dominantLanguage else { return nil }
      let confidence = recognizer.languageHypotheses(withMaximum: 1)[best] ?? 0
      return ["language": appCode(forNaturalLanguage: best.rawValue), "confidence": confidence * 100]
    }

    AsyncFunction("supportedLanguages") { () async -> [[String: String]] in
      guard #available(iOS 18.0, *) else { return [] }
      return await Translator.supportedLanguages()
    }

    // "installed" | "supported" (can be downloaded) | "unsupported"
    AsyncFunction("languageStatus") { (source: String, target: String) async -> String in
      guard #available(iOS 18.0, *) else { return "unsupported" }
      return await Translator.status(source: source, target: target)
    }

    // Shows the system sheet that downloads the models for this pair.
    AsyncFunction("downloadLanguages") { (source: String, target: String) async throws -> String in
      guard #available(iOS 18.0, *) else { throw OnDeviceException("On-device translation needs iOS 18 or later.") }
      try await Translator.prepare(source: source, target: target)
      return await Translator.status(source: source, target: target)
    }

    AsyncFunction("translate") { (text: String, source: String, target: String) async throws -> String in
      guard #available(iOS 18.0, *) else { throw OnDeviceException("On-device translation needs iOS 18 or later.") }
      return try await Translator.translate(text, source: source, target: target)
    }
  }
}

final class OnDeviceException: GenericException<String> {
  override var reason: String { param }
}

// MARK: - Text recognition

private struct RecognizedLine: Sendable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

private struct LoadedImage: @unchecked Sendable {
  let image: CGImage
  let orientation: CGImagePropertyOrientation
}

private func loadImage(_ uri: String) throws -> LoadedImage {
  let path = URL(string: uri)?.isFileURL == true ? URL(string: uri)!.path : uri
  guard let image = UIImage(contentsOfFile: path), let cgImage = image.cgImage else {
    throw OnDeviceException("Could not open the image.")
  }
  return LoadedImage(image: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation))
}

private func recognize(cgImage: CGImage, orientation: CGImagePropertyOrientation, languages: [String]) throws -> [RecognizedLine] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true

  let supported = (try? request.supportedRecognitionLanguages()) ?? []
  let wanted = languages.compactMap { visionLanguage(for: $0, supported: supported) }
  if wanted.isEmpty {
    request.automaticallyDetectsLanguage = true
  } else {
    request.recognitionLanguages = wanted
  }

  let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
  try handler.perform([request])

  return (request.results ?? []).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return RecognizedLine(
      text: candidate.string,
      x: Double(box.minX),
      y: Double(1 - box.maxY),
      width: Double(box.width),
      height: Double(box.height)
    )
  }
}

/// Maps an app language code ("en", "zh-Hant") to one Vision supports ("en-US", "zh-Hant").
private func visionLanguage(for code: String, supported: [String]) -> String? {
  let lower = code.lowercased()
  if let exact = supported.first(where: { $0.lowercased() == lower }) { return exact }
  if lower == "zh" { return supported.first { $0.hasPrefix("zh-Hans") } }
  return supported.first { $0.lowercased().hasPrefix(lower + "-") }
}

/// NaturalLanguage uses the same codes as LibreTranslate except for Chinese.
private func appCode(forNaturalLanguage code: String) -> String {
  code == "zh-Hans" ? "zh" : code
}

extension CGImagePropertyOrientation {
  init(_ orientation: UIImage.Orientation) {
    switch orientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}

// MARK: - Translation

#if canImport(Translation)
@available(iOS 18.0, *)
private enum Translator {
  static func supportedLanguages() async -> [[String: String]] {
    let languages = await LanguageAvailability().supportedLanguages
    var seen = Set<String>()
    var result: [[String: String]] = []
    for language in languages {
      let code = appCode(for: language)
      guard !seen.contains(code) else { continue }
      seen.insert(code)
      let name = Locale(identifier: "en").localizedString(forIdentifier: code == "zh" ? "zh-Hans" : code) ?? code
      result.append(["code": code, "name": name])
    }
    return result
  }

  static func status(source: String, target: String) async -> String {
    let availability = LanguageAvailability()
    let s = await resolve(source)
    let t = await resolve(target)
    switch await availability.status(from: s, to: t) {
    case .installed: return "installed"
    case .supported: return "supported"
    case .unsupported: return "unsupported"
    @unknown default: return "unsupported"
    }
  }

  static func prepare(source: String, target: String) async throws {
    let s = await resolve(source)
    let t = await resolve(target)
    _ = try await SessionHost.run(source: s, target: t) { session in
      try await session.prepareTranslation()
      return ""
    }
  }

  static func translate(_ text: String, source: String, target: String) async throws -> String {
    let s = await resolve(source)
    let t = await resolve(target)
    let status = await LanguageAvailability().status(from: s, to: t)
    guard status == .installed else {
      throw OnDeviceException(
        status == .unsupported
          ? "This language pair can't be translated on this device."
          : "Download these languages in Settings > Offline languages to translate without a connection."
      )
    }
    return try await SessionHost.run(source: s, target: t) { session in
      try await session.translate(text).targetText
    }
  }

  /// Picks the language from Apple's supported list that matches an app code, so that
  /// "en" resolves to e.g. "en-US" and "zh-Hant" to "zh-TW".
  static func resolve(_ code: String) async -> Locale.Language {
    let wanted = Locale.Language(identifier: code == "zh" ? "zh-Hans" : code)
    let supported = await LanguageAvailability().supportedLanguages
    if let exact = supported.first(where: { $0.minimalIdentifier == wanted.minimalIdentifier }) {
      return exact
    }
    let wantedScript = Locale.Language(identifier: wanted.maximalIdentifier).script
    if let match = supported.first(where: {
      $0.languageCode == wanted.languageCode
        && Locale.Language(identifier: $0.maximalIdentifier).script == wantedScript
    }) {
      return match
    }
    return wanted
  }

  /// The code the app (and LibreTranslate) uses for an Apple language.
  static func appCode(for language: Locale.Language) -> String {
    guard let base = language.languageCode?.identifier else { return language.minimalIdentifier }
    if base == "zh" {
      let script = Locale.Language(identifier: language.maximalIdentifier).script?.identifier
      return script == "Hant" ? "zh-Hant" : "zh"
    }
    return base
  }
}

/// TranslationSession is handed out by SwiftUI's `.translationTask`. This mounts a tiny
/// invisible SwiftUI view in the key window, runs the work with its session, and removes it.
@available(iOS 18.0, *)
@MainActor
private enum SessionHost {
  static func run(
    source: Locale.Language,
    target: Locale.Language,
    _ work: @escaping (TranslationSession) async throws -> String
  ) async throws -> String {
    guard let root = Utilities.keyWindow()?.rootViewController else {
      throw OnDeviceException("The app isn't ready to translate yet.")
    }
    return try await withCheckedThrowingContinuation { continuation in
      var host: UIHostingController<SessionView>?
      let view = SessionView(configuration: .init(source: source, target: target)) { session in
        do {
          continuation.resume(returning: try await work(session))
        } catch {
          continuation.resume(throwing: error)
        }
        await MainActor.run {
          host?.willMove(toParent: nil)
          host?.view.removeFromSuperview()
          host?.removeFromParent()
          host = nil
        }
      }
      let controller = UIHostingController(rootView: view)
      controller.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
      controller.view.backgroundColor = .clear
      controller.view.isUserInteractionEnabled = false
      root.addChild(controller)
      root.view.addSubview(controller.view)
      controller.didMove(toParent: root)
      host = controller
    }
  }
}

@available(iOS 18.0, *)
private struct SessionView: View {
  let configuration: TranslationSession.Configuration
  let action: (TranslationSession) async -> Void

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .translationTask(configuration, action: action)
  }
}
#else
private enum Translator {
  static func supportedLanguages() async -> [[String: String]] { [] }
  static func status(source: String, target: String) async -> String { "unsupported" }
  static func prepare(source: String, target: String) async throws {
    throw OnDeviceException("On-device translation isn't available in this build.")
  }
  static func translate(_ text: String, source: String, target: String) async throws -> String {
    throw OnDeviceException("On-device translation isn't available in this build.")
  }
}
#endif
