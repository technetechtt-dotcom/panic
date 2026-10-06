import Foundation

public struct DistressCapsule: Encodable {
    public var timestamp: String
    public var latitude: Double?
    public var longitude: Double?
    public var locationAccuracy: Double?
    public var speed: Double?
    public var heading: Double?
    public var batteryLevel: Double?
    public var chargingStatus: Bool
    public var networkType: String
    public var protectionMode: String
    public var duress: Bool
    public var lastKnownLocation: LastKnown?
    public var appProtectionStatus: String
}

public struct LastKnown: Encodable {
    public var latitude: Double
    public var longitude: Double
    public var accuracy: Double?
    public var recordedAt: String
}

public struct SosRequest: Encodable {
    public var triggerId: String
    public var correlationId: String
    public var triggerType: String
    public var deviceId: String
    public var isTest: Bool
    public var distressCapsule: DistressCapsule
}

public enum SosClientError: Error {
    case http(Int)
}

public struct SosClient {
    public var baseURL: URL
    public var token: String

    public init(baseURL: URL, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    public func send(_ request: SosRequest) async throws -> Data {
        var call = URLRequest(url: baseURL.appendingPathComponent("incidents"))
        call.httpMethod = "POST"
        call.setValue("application/json", forHTTPHeaderField: "Content-Type")
        call.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        call.httpBody = try JSONEncoder().encode(request)
        let (data, response) = try await URLSession.shared.data(for: call)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw SosClientError.http(status) }
        return data
    }
}
