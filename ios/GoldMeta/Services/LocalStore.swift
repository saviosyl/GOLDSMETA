import Foundation

final class LocalStore {
    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private enum Key {
        static let settings = "goldmeta.settings"
        static let decisions = "goldmeta.decisions"
        static let journalEntries = "goldmeta.journalEntries"
    }

    init(suiteName: String? = nil) {
        if let suiteName, let suiteDefaults = UserDefaults(suiteName: suiteName) {
            defaults = suiteDefaults
        } else {
            defaults = .standard
        }
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    func loadSettings() -> UserSettings {
        load(UserSettings.self, key: Key.settings) ?? .default
    }

    func saveSettings(_ settings: UserSettings) {
        save(settings, key: Key.settings)
    }

    func loadCachedDecisions() -> [Decision] {
        load([Decision].self, key: Key.decisions) ?? []
    }

    func saveCachedDecisions(_ decisions: [Decision]) {
        save(decisions, key: Key.decisions)
    }

    func loadJournalEntries() -> [JournalEntry] {
        load([JournalEntry].self, key: Key.journalEntries) ?? []
    }

    func saveJournalEntries(_ entries: [JournalEntry]) {
        save(entries, key: Key.journalEntries)
    }

    func clearAll() {
        [Key.settings, Key.decisions, Key.journalEntries].forEach { defaults.removeObject(forKey: $0) }
    }

    private func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? decoder.decode(T.self, from: data)
    }

    private func save<T: Encodable>(_ value: T, key: String) {
        guard let data = try? encoder.encode(value) else { return }
        defaults.set(data, forKey: key)
    }
}
