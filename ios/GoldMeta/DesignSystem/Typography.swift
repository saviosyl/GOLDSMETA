import SwiftUI

struct GoldMetaFont {
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func rounded(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        .system(style, design: .rounded).weight(weight)
    }

    static let caption = Font.system(.caption, design: .rounded).weight(.medium)
    static let body = Font.system(.body, design: .rounded)
    static let title = Font.system(.title2, design: .rounded).weight(.semibold)
    static let price = Font.system(size: 44, weight: .bold, design: .rounded)
}
