import SwiftUI

struct GoldCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(GoldMetaColor.surface.opacity(0.96))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(GoldMetaColor.gold.opacity(0.22), lineWidth: 1)
                    )
            )
            .shadow(color: .black.opacity(0.35), radius: 18, x: 0, y: 12)
    }
}

struct DecisionBadge: View {
    let decision: DecisionType
    let isProvisional: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(decision.color).frame(width: 8, height: 8)
            Text(isProvisional ? "\(decision.rawValue) PROVISIONAL" : decision.rawValue)
                .font(GoldMetaFont.rounded(.headline, weight: .bold))
        }
        .foregroundStyle(decision.color)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Capsule().fill(decision.color.opacity(0.14)))
        .accessibilityLabel("Decision \(decision.accessibilityLabel)\(isProvisional ? ", provisional" : "")")
    }
}

struct DataQualityBadge: View {
    let dataQuality: DataQuality
    let source: DataSourceLabel

    var body: some View {
        HStack(spacing: 8) {
            Text(dataQuality.rawValue)
            Text(source.rawValue)
        }
        .font(GoldMetaFont.caption)
        .foregroundStyle(source.color)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Capsule().fill(source.color.opacity(0.14)))
        .accessibilityLabel("Data quality \(dataQuality.rawValue), source \(source.rawValue)")
    }
}

struct PriceRow: View {
    let title: String
    let value: String
    let detail: String?

    init(_ title: String, value: String, detail: String? = nil) {
        self.title = title
        self.value = value
        self.detail = detail
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(GoldMetaFont.caption)
                    .foregroundStyle(GoldMetaColor.textSecondary)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(GoldMetaColor.textSecondary.opacity(0.8))
                }
            }
            Spacer(minLength: 12)
            Text(value)
                .font(GoldMetaFont.rounded(.body, weight: .semibold))
                .foregroundStyle(GoldMetaColor.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

struct DisclaimerBanner: View {
    var compact = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .foregroundStyle(GoldMetaColor.gold)
            Text(AppCopy.disclaimer)
                .font(compact ? .caption : GoldMetaFont.rounded(.callout))
                .foregroundStyle(GoldMetaColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(GoldMetaColor.gold.opacity(0.10)))
        .accessibilityLabel("Risk disclaimer. \(AppCopy.disclaimer)")
    }
}

struct SectionHeader: View {
    let title: String
    let subtitle: String?

    init(_ title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(GoldMetaFont.rounded(.title3, weight: .semibold))
                .foregroundStyle(GoldMetaColor.textPrimary)
            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(GoldMetaColor.textSecondary)
            }
        }
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String

    var body: some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(GoldMetaFont.title)
                Text(message).foregroundStyle(GoldMetaColor.textSecondary)
            }
        }
    }
}

struct GoldPrimaryButton: View {
    let title: String
    let systemImage: String?
    let action: () -> Void

    init(_ title: String, systemImage: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title)
            }
                .font(GoldMetaFont.rounded(.headline, weight: .bold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    LinearGradient(colors: [GoldMetaColor.gold, Color(red: 0.98, green: 0.78, blue: 0.33)], startPoint: .leading, endPoint: .trailing),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
                .foregroundStyle(Color.black.opacity(0.86))
        }
        .buttonStyle(.plain)
    }
}

struct AppCopy {
    static let disclaimer = "GoldMeta provides market analysis and decision support only. Trading involves substantial risk. Signals are not guaranteed, and you remain responsible for every trading decision."
}
