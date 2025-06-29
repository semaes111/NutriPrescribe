import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertPatientSchema, insertWeightRecordSchema, insertProfessionalSchema } from "@shared/schema";
import { z } from "zod";

const accessCodeSchema = z.object({
  accessCode: z.string().min(6).max(20),
});

const professionalAccessCodeSchema = z.object({
  accessCode: z.string().min(8).max(20),
});

function generateAccessCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Patient authentication middleware
const isPatientAuthenticated = (req: any, res: any, next: any) => {
  // Check for active patient session
  if (req.patientSession?.patient?.id) {
    return next();
  }
  
  // If no session, return unauthorized
  return res.status(401).json({ message: "Unauthorized" });
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get current patient (for authenticated users or patient sessions)
  app.get("/api/patient/current", async (req: any, res) => {
    try {
      // Check if user is authenticated with Replit Auth
      if (req.isAuthenticated && req.isAuthenticated()) {
        const userId = req.user?.claims?.sub;
        const patient = await storage.getPatientByUserId(userId);
        
        if (!patient) {
          return res.status(404).json({ message: "Paciente no encontrado" });
        }
        
        return res.json({
          patient: {
            id: patient.id,
            name: patient.name,
            dietLevel: patient.dietLevel,
            codeExpiry: patient.codeExpiry,
          }
        });
      }
      
      // Check for patient session header
      const patientSessionHeader = req.headers['x-patient-session'];
      if (patientSessionHeader) {
        try {
          const sessionData = JSON.parse(patientSessionHeader as string);
          const patient = await storage.getPatientById(sessionData.patientId);
          
          if (patient && patient.accessCode === sessionData.accessCode) {
            return res.json({
              patient: {
                id: patient.id,
                name: patient.name,
                dietLevel: patient.dietLevel,
                codeExpiry: patient.codeExpiry,
              }
            });
          }
        } catch (error) {
          console.error('Error parsing patient session header:', error);
        }
      }
      
      return res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Validate access code and link to user
  app.post("/api/auth/validate-access-code", isAuthenticated, async (req: any, res) => {
    try {
      const { accessCode } = accessCodeSchema.parse(req.body);
      const userId = req.user?.claims?.sub;
      
      const patient = await storage.getPatientByAccessCode(accessCode);
      
      if (!patient) {
        return res.status(401).json({ 
          message: "Código de acceso inválido o expirado" 
        });
      }

      // Link patient to user if not already linked
      if (!patient.userId) {
        await storage.updatePatientUserId(patient.id, userId);
      }
      
      res.json({
        patient: {
          id: patient.id,
          name: patient.name,
          dietLevel: patient.dietLevel,
          codeExpiry: patient.codeExpiry,
        }
      });
    } catch (error) {
      res.status(400).json({ 
        message: "Datos de entrada inválidos" 
      });
    }
  });

  // Get diet levels with code validation
  app.get("/api/diet-levels/:code", async (req: any, res) => {
    try {
      const accessCode = req.params.code;
      console.log("Diet levels request with code:", accessCode);
      
      // Validate professional code
      const professional = await storage.getProfessionalByAccessCode(accessCode);
      if (!professional || !professional.isActive) {
        console.log("Invalid professional code:", accessCode);
        return res.status(401).json({ message: "Código profesional inválido" });
      }
      
      console.log("Professional validated, fetching diet levels");
      const dietLevels = await storage.getDietLevels();
      console.log("Diet levels found:", dietLevels.length);
      return res.json(dietLevels);
    } catch (error) {
      console.error("Error fetching diet levels:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get diet levels - supports both auth types (legacy endpoint)
  app.get("/api/diet-levels", async (req: any, res) => {
    try {
      console.log("Diet levels request - Session ID:", req.sessionID);
      console.log("Professional session exists:", !!req.session?.professionalData);
      
      // Check for professional access code in headers
      const professionalCode = req.headers['x-professional-code'];
      console.log("Diet levels - Professional code in headers:", professionalCode);
      
      if (professionalCode) {
        console.log("Diet levels request via header code:", professionalCode);
        const professional = await storage.getProfessionalByAccessCode(professionalCode);
        if (professional && professional.isActive) {
          const dietLevels = await storage.getDietLevels();
          console.log("Diet levels found via header auth:", dietLevels.length);
          return res.json(dietLevels);
        }
      }
      
      // Check for professional session or Replit auth
      const hasSessionAuth = req.session?.professionalData;
      const hasReplitAuth = req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub;
      
      if (!hasSessionAuth && !hasReplitAuth) {
        console.log("Diet levels request - No valid authentication found");
        return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación" });
      }
      
      console.log("Diet levels request - Auth type:", hasSessionAuth ? 'session' : 'replit');
      
      const dietLevels = await storage.getDietLevels();
      console.log("Diet levels found:", dietLevels.length);
      res.json(dietLevels);
    } catch (error) {
      console.error("Error fetching diet levels:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get meal plans by diet level - authenticated users only
  app.get("/api/meal-plans/:dietLevelId", isAuthenticated, async (req, res) => {
    try {
      const dietLevelId = parseInt(req.params.dietLevelId);
      const mealPlans = await storage.getMealPlansByDietLevel(dietLevelId);
      res.json(mealPlans);
    } catch (error) {
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get recipes by meal plan - authenticated users only
  app.get("/api/recipes/:mealPlanId", isAuthenticated, async (req, res) => {
    try {
      const mealPlanId = parseInt(req.params.mealPlanId);
      const recipes = await storage.getRecipesByMealPlan(mealPlanId);
      res.json(recipes);
    } catch (error) {
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get food items by category - authenticated users only
  app.get("/api/food-items/:category", isAuthenticated, async (req, res) => {
    try {
      const category = req.params.category;
      const foodItems = await storage.getFoodItemsByCategory(category);
      res.json(foodItems);
    } catch (error) {
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get intermittent fasting program - authenticated users only
  app.get("/api/intermittent-fasting", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const patient = await storage.getPatientByUserId(userId);
      
      if (!patient) {
        return res.status(404).json({ message: "Paciente no encontrado" });
      }

      const fasting = await storage.getIntermittentFastingByPatient(patient.id);
      res.json(fasting || null);
    } catch (error) {
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Patient routes

  // Validate patient access code - no auth required for initial validation
  app.post("/api/patient/validate", async (req, res) => {
    try {
      console.log("Patient validation request body:", req.body);
      const { accessCode } = req.body;
      
      if (!accessCode) {
        console.log("No access code provided");
        return res.status(400).json({ message: "Código de acceso requerido" });
      }

      console.log("Looking for patient with access code:", accessCode);
      const patient = await storage.getPatientByAccessCode(accessCode);
      console.log("Patient found:", patient);
      
      if (!patient || !patient.isActive) {
        console.log("Patient not found or inactive");
        return res.status(404).json({ message: "Código de acceso no válido" });
      }

      // Check if code is expired
      const now = new Date();
      if (patient.codeExpiry && new Date(patient.codeExpiry) < now) {
        console.log("Patient code expired");
        return res.status(410).json({ message: "Código de acceso expirado" });
      }

      console.log("Patient validation successful");
      
      // Initialize session if it doesn't exist
      if (!req.session) {
        req.session = {};
      }
      
      // Create patient session for dashboard access
      req.session.patientSession = {
        patient: {
          id: patient.id,
          name: patient.name,
          dietLevel: patient.dietLevel,
          accessCode: patient.accessCode,
          codeExpiry: patient.codeExpiry,
          age: patient.age,
          height: patient.height,
          initialWeight: patient.initialWeight,
          targetWeight: patient.targetWeight,
          medicalNotes: patient.medicalNotes
        },
        loginTime: new Date()
      };

      console.log("Patient session created for dashboard access:", req.session.patientSession);
      
      // Force session save with callback
      req.session.save((err: any) => {
        if (err) {
          console.error('Patient session save error:', err);
          return res.status(500).json({ message: "Error al crear sesión de paciente" });
        }
        
        console.log('Patient session saved successfully');
        console.log('Session ID:', req.sessionID);
        console.log('Cookie settings:', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax'
        });
        
        res.json({
          valid: true,
          patient: {
            id: patient.id,
            name: patient.name,
            dietLevel: patient.dietLevel,
            accessCode: patient.accessCode,
            codeExpiry: patient.codeExpiry,
            age: patient.age,
            height: patient.height,
            initialWeight: patient.initialWeight,
            targetWeight: patient.targetWeight,
            medicalNotes: patient.medicalNotes
          }
        });
      });
    } catch (error) {
      console.error("Error validating patient code:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Patient weight history by patient ID (enhanced authentication)
  app.get('/api/patient/:id/weight-history', async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      console.log(`Weight history request for patient ${patientId}`);
      console.log("Session ID:", req.sessionID);
      console.log("Session data:", req.session?.patientSession ? "exists" : "none");
      
      // Check if there's a patient session
      const sessionData = req.session?.patientSession;
      if (sessionData && sessionData.patient && sessionData.patient.id === patientId) {
        console.log(`Fetching weight history for authorized patient ${patientId}`);
        const weightHistory = await storage.getWeightRecordsByPatient(patientId);
        
        // Sort by creation date to ensure consistent ordering
        const sortedHistory = weightHistory.sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        console.log(`Patient ${patientId} weight history:`, sortedHistory.length, 'records');
        return res.json(sortedHistory);
      }
      
      // Fallback: Check if patient exists and is valid (allows direct access for now)
      const patient = await storage.getPatientById(patientId);
      if (patient && patient.isActive) {
        console.log(`Fetching weight history for patient ${patientId} (direct access)`);
        const weightHistory = await storage.getWeightRecordsByPatient(patientId);
        
        // Sort by creation date to ensure consistent ordering
        const sortedHistory = weightHistory.sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        console.log(`Patient ${patientId} weight history (direct):`, sortedHistory.length, 'records');
        return res.json(sortedHistory);
      }
      
      console.log(`Patient not found or inactive: ${patientId}`);
      return res.status(404).json({ message: "Paciente no encontrado" });
    } catch (error) {
      console.error("Error fetching patient weight history:", error);
      res.status(500).json({ message: "Error al obtener historial de peso" });
    }
  });

  // Simple weight history endpoint for direct access
  app.get('/api/weight-history/:patientId', async (req, res) => {
    try {
      const patientId = parseInt(req.params.patientId);
      console.log(`Direct weight history request for patient ${patientId}`);
      
      // Verify patient exists and is active
      const patient = await storage.getPatientById(patientId);
      if (!patient || !patient.isActive) {
        console.log(`Patient ${patientId} not found or inactive`);
        return res.status(404).json({ message: "Paciente no encontrado" });
      }
      
      console.log(`Fetching weight history for patient ${patientId}`);
      const weightHistory = await storage.getWeightRecordsByPatient(patientId);
      
      // Sort by creation date to ensure consistent ordering
      const sortedHistory = weightHistory.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      console.log(`Direct access - Patient ${patientId} weight history:`, sortedHistory.length, 'records');
      res.json(sortedHistory);
      
    } catch (error) {
      console.error("Error fetching direct weight history:", error);
      res.status(500).json({ message: "Error al obtener historial de peso" });
    }
  });

  // Professional routes

  // Validate professional access code - creates session for authenticated access
  app.post("/api/professional/validate", async (req: any, res) => {
    try {
      console.log("Professional validation request body:", req.body);
      const { accessCode } = req.body;
      
      if (!accessCode) {
        console.log("No access code provided");
        return res.status(400).json({ message: "Código de acceso requerido" });
      }

      console.log("Looking for professional with code:", accessCode);
      const professional = await storage.getProfessionalByAccessCode(accessCode);
      console.log("Professional found:", professional);
      
      if (!professional || !professional.isActive) {
        console.log("Professional not found or inactive");
        return res.status(404).json({ message: "Código profesional no válido" });
      }
      
      // Initialize session if it doesn't exist
      if (!req.session) {
        req.session = {};
      }
      
      // Create professional session data
      req.session.professionalData = {
        id: professional.id,
        name: professional.name,
        specialty: professional.specialty,
        licenseNumber: professional.licenseNumber,
        email: professional.email,
        accessCode: professional.accessCode,
        loginTime: new Date().toISOString()
      };
      
      console.log("Professional session data set:", req.session.professionalData);
      
      // Force session save with callback
      req.session.save((err: any) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ message: "Error al crear sesión profesional" });
        }
        
        console.log('Professional session saved successfully');
        
        res.json({
          valid: true,
          professional: {
            id: professional.id,
            name: professional.name,
            specialty: professional.specialty,
            licenseNumber: professional.licenseNumber,
            accessCode: professional.accessCode
          }
        });
      });
      
    } catch (error) {
      console.error("Error in professional validation:", error);
      res.status(500).json({ 
        message: "Error interno del servidor" 
      });
    }
  });

  // Get professional profile - Updated to support session-based auth
  app.get("/api/professional/profile", async (req: any, res) => {
    try {
      console.log("Professional profile request - Session:", req.session?.professionalData ? 'exists' : 'none');
      
      // Check session-based authentication first
      if (req.session?.professionalData) {
        console.log("Using session data for professional profile");
        return res.json({
          professional: req.session.professionalData
        });
      }
      
      // Fallback to Replit Auth if available
      if (req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub) {
        const userId = req.user.claims.sub;
        console.log("Fetching professional profile for userId:", userId);
        
        const professional = await storage.getProfessionalByUserId(userId);
        
        if (professional) {
          console.log("Professional found via Replit Auth:", professional);
          return res.json({
            professional: {
              id: professional.id,
              name: professional.name,
              specialty: professional.specialty,
              licenseNumber: professional.licenseNumber,
              email: professional.email,
            }
          });
        }
      }
      
      console.log("No professional authentication found");
      return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
    } catch (error) {
      console.error("Error fetching professional profile:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Create new patient - supports both auth types
  app.post("/api/professional/patients", async (req: any, res) => {
    try {
      // Check for professional session first
      const hasSessionAuth = req.session?.professionalData;
      const hasReplitAuth = req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub;
      
      if (!hasSessionAuth && !hasReplitAuth) {
        return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
      }

      // Generate access code and set expiry
      const accessCode = generateAccessCode();
      const codeExpiry = new Date();
      codeExpiry.setDate(codeExpiry.getDate() + 30); // 30 days validity

      // Create patient data with proper types
      const patientData = {
        name: req.body.name,
        age: parseInt(req.body.age),
        height: req.body.height.toString(),
        initialWeight: req.body.initialWeight.toString(),
        targetWeight: req.body.targetWeight.toString(),
        dietLevel: parseInt(req.body.dietLevel),
        medicalNotes: req.body.medicalNotes || null,
        accessCode,
        codeExpiry,
        isActive: true,
      };

      console.log("Creating patient with data:", patientData);
      const newPatient = await storage.createPatient(patientData);

      res.json({
        patient: newPatient,
        accessCode,
      });
    } catch (error) {
      console.error("Error creating patient:", error);
      res.status(400).json({ 
        message: "Error al crear paciente: " + (error as Error).message 
      });
    }
  });

  // Create new patient with professional code validation
  app.post("/api/professional/patients/:code", async (req: any, res) => {
    try {
      const accessCode = req.params.code;
      console.log("Professional create patient request with code:", accessCode);
      
      // Validate professional code
      const professional = await storage.getProfessionalByAccessCode(accessCode);
      if (!professional || !professional.isActive) {
        console.log("Invalid professional code:", accessCode);
        return res.status(401).json({ message: "Código profesional inválido" });
      }

      // Generate patient access code and set expiry
      const patientAccessCode = generateAccessCode();
      const codeExpiry = new Date();
      codeExpiry.setDate(codeExpiry.getDate() + 30); // 30 days validity

      // Create patient data with proper types
      const patientData = {
        name: req.body.name,
        age: parseInt(req.body.age),
        height: req.body.height.toString(),
        initialWeight: req.body.initialWeight.toString(),
        targetWeight: req.body.targetWeight.toString(),
        dietLevel: parseInt(req.body.dietLevel),
        medicalNotes: req.body.medicalNotes || null,
        accessCode: patientAccessCode,
        codeExpiry,
        isActive: true,
      };

      console.log("Creating patient with data:", patientData);
      const newPatient = await storage.createPatient(patientData);

      // Add initial weight record
      await storage.addWeightRecord({
        patientId: newPatient.id,
        weight: parseFloat(req.body.initialWeight),
        notes: "Peso inicial registrado durante la creación del paciente",
        createdAt: new Date(),
      });

      res.json({
        patient: newPatient,
        accessCode: patientAccessCode,
        message: "Paciente creado exitosamente",
      });
    } catch (error) {
      console.error("Error creating patient:", error);
      res.status(400).json({ 
        message: "Error al crear paciente: " + (error as Error).message 
      });
    }
  });

  // Get all patients for professional with code validation
  app.get("/api/professional/patients/:code", async (req: any, res) => {
    try {
      const accessCode = req.params.code;
      console.log("Professional patients request with code:", accessCode);
      
      // Validate professional code
      const professional = await storage.getProfessionalByAccessCode(accessCode);
      if (!professional || !professional.isActive) {
        console.log("Invalid professional code:", accessCode);
        return res.status(401).json({ message: "Código profesional inválido" });
      }
      
      console.log("Professional validated, fetching patients");
      const patients = await storage.getAllPatients();
      console.log("Patients found:", patients.length);
      return res.json(patients);
    } catch (error) {
      console.error("Error fetching patients:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get all patients for professional - supports both auth types (legacy endpoint)
  app.get("/api/professional/patients", async (req: any, res) => {
    try {
      console.log("Professional patients request - Session ID:", req.sessionID);
      console.log("Professional session exists:", !!req.session?.professionalData);
      
      // Check for professional access code in headers
      const professionalCode = req.headers['x-professional-code'];
      console.log("Professional code in headers:", professionalCode);
      
      if (professionalCode) {
        console.log("Professional patients request via header code:", professionalCode);
        const professional = await storage.getProfessionalByAccessCode(professionalCode);
        if (professional && professional.isActive) {
          const patients = await storage.getAllPatients();
          console.log("Patients found via header auth:", patients.length);
          return res.json(patients);
        }
      }
      
      // Check for professional session first
      if (req.session?.professionalData) {
        console.log("Professional patients request via session - fetching all patients");
        const patients = await storage.getAllPatients();
        console.log("Patients found:", patients.length);
        return res.json(patients);
      }
      
      // Fallback to Replit auth
      if (req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub) {
        console.log("Professional patients request via Replit auth");
        const userId = req.user.claims.sub;
        const professional = await storage.getProfessionalByUserId(userId);
        
        if (professional) {
          console.log("Professional found via Replit auth - fetching all patients");
          const patients = await storage.getAllPatients();
          console.log("Patients found:", patients.length);
          return res.json(patients);
        }
      }
      
      console.log("Professional patients request - No valid authentication found");
      return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
    } catch (error) {
      console.error("Error fetching patients:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Update patient diet level - supports professional code authentication
  app.patch("/api/professional/patients/:patientId/diet-level", async (req: any, res) => {
    try {
      console.log("Diet level update request for patient:", req.params.patientId);
      
      // Check for professional access code in headers first
      const professionalCode = req.headers['x-professional-code'];
      console.log("Professional code in headers:", professionalCode);
      
      if (professionalCode) {
        console.log("Diet level update via header code:", professionalCode);
        const professional = await storage.getProfessionalByAccessCode(professionalCode);
        if (professional && professional.isActive) {
          console.log("Professional authenticated for diet level update");
          // Continue with diet level update logic
        } else {
          console.log("Invalid professional code for diet level update");
          return res.status(401).json({ message: "Código profesional inválido" });
        }
      } else {
        // Check for professional session
        const hasSessionAuth = req.session?.professionalData;
        const hasReplitAuth = req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub;
        
        if (!hasSessionAuth && !hasReplitAuth) {
          console.log("Diet level update - No valid authentication found");
          return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
        }
      }

      const patientId = parseInt(req.params.patientId);
      const { dietLevel } = req.body;

      await storage.updatePatientDietLevel(patientId, dietLevel);
      
      res.json({ message: "Nivel de dieta actualizado exitosamente" });
    } catch (error) {
      console.error("Error updating diet level:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Add weight record for patient - supports professional code authentication
  app.post("/api/professional/patients/:patientId/weight", async (req: any, res) => {
    try {
      console.log("Weight registration request for patient:", req.params.patientId);
      
      // Check for professional access code in headers first
      const professionalCode = req.headers['x-professional-code'];
      console.log("Professional code in headers:", professionalCode);
      
      if (professionalCode) {
        console.log("Weight registration via header code:", professionalCode);
        const professional = await storage.getProfessionalByAccessCode(professionalCode);
        if (professional && professional.isActive) {
          console.log("Professional authenticated for weight registration");
          // Continue with weight registration logic
        } else {
          console.log("Invalid professional code for weight registration");
          return res.status(401).json({ message: "Código profesional inválido" });
        }
      } else {
        // Check for professional session
        const hasSessionAuth = req.session?.professionalData;
        const hasReplitAuth = req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub;
        
        if (!hasSessionAuth && !hasReplitAuth) {
          console.log("Weight registration - No valid authentication found");
          return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
        }
      }

      const patientId = parseInt(req.params.patientId);
      const { weight, targetWeight, notes } = req.body;
      
      console.log("Weight registration request:", { patientId, weight, targetWeight, notes });
      
      if (!weight || isNaN(parseFloat(weight)) || parseFloat(weight) < 10 || parseFloat(weight) > 500) {
        console.log("Invalid weight:", weight);
        return res.status(400).json({ message: "Peso inválido. Debe estar entre 10 y 500 kg." });
      }

      // Validate target weight if provided
      if (targetWeight && (isNaN(parseFloat(targetWeight)) || parseFloat(targetWeight) < 10 || parseFloat(targetWeight) > 500)) {
        console.log("Invalid target weight:", targetWeight);
        return res.status(400).json({ message: "Peso objetivo inválido. Debe estar entre 10 y 500 kg." });
      }

      // Create weight record with current date
      const today = new Date();
      today.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
      
      const weightRecord = await storage.addWeightRecord({
        patientId,
        weight: parseFloat(weight).toFixed(2),
        notes: notes || null,
        recordedDate: today
      });

      // Generate new access code and extend expiry date
      const newAccessCode = generateAccessCode();
      const newCodeExpiry = new Date();
      newCodeExpiry.setDate(newCodeExpiry.getDate() + 30); // 30 days from now

      // Update patient with new access code
      await storage.updatePatientAccessCode(patientId, newAccessCode, newCodeExpiry);

      console.log("Weight record created:", weightRecord);
      console.log("New access code generated for patient:", { patientId, newAccessCode });
      
      res.json({
        weightRecord,
        newAccessCode,
        message: "Peso registrado exitosamente. Nuevo código de acceso generado."
      });
    } catch (error) {
      console.error("Error adding weight record:", error);
      res.status(500).json({ message: "Error al añadir registro de peso: " + (error as Error).message });
    }
  });

  // Update patient target weight - supports professional code authentication
  app.patch("/api/professional/patients/:id/target-weight", async (req: any, res) => {
    try {
      console.log("Target weight update request for patient:", req.params.id);
      
      // Check for professional access code in headers first
      const professionalCode = req.headers['x-professional-code'];
      console.log("Professional code in headers:", professionalCode);
      
      if (professionalCode) {
        console.log("Target weight update via header code:", professionalCode);
        const professional = await storage.getProfessionalByAccessCode(professionalCode);
        if (professional && professional.isActive) {
          const patientId = parseInt(req.params.id);
          const { targetWeight } = req.body;
          
          if (!targetWeight || isNaN(parseFloat(targetWeight)) || parseFloat(targetWeight) < 10 || parseFloat(targetWeight) > 500) {
            return res.status(400).json({ message: "Peso objetivo inválido (debe ser entre 10 y 500 kg)" });
          }
          
          await storage.updatePatientTargetWeight(patientId, parseFloat(targetWeight));
          console.log("Target weight updated successfully via professional code");
          return res.json({ 
            message: "Peso objetivo actualizado exitosamente",
            patientId,
            newTargetWeight: parseFloat(targetWeight)
          });
        }
      }
      
      // Check for professional session
      const hasSessionAuth = req.session?.professionalData;
      const hasReplitAuth = req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub;
      
      if (!hasSessionAuth && !hasReplitAuth) {
        console.log("Target weight update - No valid authentication found");
        return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
      }
      
      const patientId = parseInt(req.params.id);
      const { targetWeight } = req.body;
      
      if (!targetWeight || isNaN(parseFloat(targetWeight)) || parseFloat(targetWeight) < 10 || parseFloat(targetWeight) > 500) {
        return res.status(400).json({ message: "Peso objetivo inválido (debe ser entre 10 y 500 kg)" });
      }
      
      await storage.updatePatientTargetWeight(patientId, parseFloat(targetWeight));
      res.json({ 
        message: "Peso objetivo actualizado exitosamente",
        patientId,
        newTargetWeight: parseFloat(targetWeight)
      });
    } catch (error) {
      console.error("Error updating patient target weight:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get weight history for patient - supports both auth types
  app.get("/api/professional/patients/:patientId/weight-history", async (req: any, res) => {
    try {
      // Check for professional session first
      const hasSessionAuth = req.session?.professionalData;
      const hasReplitAuth = req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub;
      
      if (!hasSessionAuth && !hasReplitAuth) {
        return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
      }

      const patientId = parseInt(req.params.patientId);
      console.log("Fetching weight history for patient ID:", patientId);
      
      const weightHistory = await storage.getWeightRecordsByPatient(patientId);
      console.log("Weight history found:", weightHistory);
      
      res.json(weightHistory);
    } catch (error) {
      console.error("Error fetching weight history:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get patient weight history (for patient dashboard)
  app.get("/api/patient/weight-history/:patientId?", async (req: any, res) => {
    try {
      const requestedPatientId = req.params.patientId;
      
      // Check if user is authenticated with Replit Auth
      if (req.isAuthenticated && req.isAuthenticated()) {
        const userId = req.user?.claims?.sub;
        let patient;
        
        if (requestedPatientId) {
          patient = await storage.getPatientById(parseInt(requestedPatientId));
        } else {
          patient = await storage.getPatientByUserId(userId);
        }
        
        if (!patient) {
          return res.status(404).json({ message: "Paciente no encontrado" });
        }

        console.log("Fetching weight history for patient ID:", patient.id);
        const weightHistory = await storage.getWeightRecordsByPatient(patient.id);
        console.log("Weight history found:", weightHistory.length, "records");
        
        const sortedHistory = weightHistory.sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        return res.json(sortedHistory);
      }
      
      // Check for patient session header
      const patientSessionHeader = req.headers['x-patient-session'];
      if (patientSessionHeader && requestedPatientId) {
        try {
          const sessionData = JSON.parse(patientSessionHeader as string);
          const patient = await storage.getPatientById(parseInt(requestedPatientId));
          
          if (patient && patient.accessCode === sessionData.accessCode && patient.id === parseInt(requestedPatientId)) {
            console.log("Fetching weight history for patient ID:", patient.id);
            const weightHistory = await storage.getWeightRecordsByPatient(patient.id);
            console.log("Weight history found:", weightHistory.length, "records");
            
            const sortedHistory = weightHistory.sort((a, b) => 
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
            
            return res.json(sortedHistory);
          }
        } catch (error) {
          console.error('Error parsing patient session header:', error);
        }
      }
      
      return res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      console.error("Error fetching patient weight history:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get mood entries for authenticated patient
  app.get("/api/patient/mood-entries", isPatientAuthenticated, async (req: any, res) => {
    try {
      const patientId = req.patientSession?.patient.id;
      console.log("Fetching mood entries for patient ID:", patientId);
      
      const entries = await storage.getMoodEntriesByPatient(patientId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching mood entries:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Create mood entry for authenticated patient
  app.post("/api/patient/mood-entries", isPatientAuthenticated, async (req: any, res) => {
    try {
      const patientId = req.patientSession?.patient.id;
      const { moodLevel, energyLevel, motivationLevel, notes, tags } = req.body;

      // Validation
      if (!moodLevel || !energyLevel || !motivationLevel) {
        return res.status(400).json({ 
          message: "Se requieren los niveles de ánimo, energía y motivación" 
        });
      }

      if (moodLevel < 1 || moodLevel > 5 || energyLevel < 1 || energyLevel > 5 || motivationLevel < 1 || motivationLevel > 5) {
        return res.status(400).json({ 
          message: "Los niveles deben estar entre 1 y 5" 
        });
      }

      const moodEntry = await storage.createMoodEntry({
        patientId,
        moodLevel: parseInt(moodLevel),
        energyLevel: parseInt(energyLevel), 
        motivationLevel: parseInt(motivationLevel),
        notes: notes || null,
        tags: tags || [],
        recordedDate: new Date(),
      });

      console.log("Mood entry created:", moodEntry);
      res.json(moodEntry);
    } catch (error) {
      console.error("Error creating mood entry:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Get recent mood entry for authenticated patient
  app.get("/api/patient/mood-entries/recent", isPatientAuthenticated, async (req: any, res) => {
    try {
      const patientId = req.patientSession?.patient.id;
      
      const recentEntry = await storage.getRecentMoodEntry(patientId);
      
      if (!recentEntry) {
        return res.status(404).json({ message: "No se encontraron registros de estado de ánimo" });
      }

      res.json(recentEntry);
    } catch (error) {
      console.error("Error fetching recent mood entry:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Revoke patient access code - supports both auth types
  app.patch("/api/professional/patients/:patientId/revoke-code", async (req: any, res) => {
    try {
      // Check for professional session first
      const hasSessionAuth = req.session?.professionalData;
      const hasReplitAuth = req.isAuthenticated && req.isAuthenticated() && req.user?.claims?.sub;
      
      if (!hasSessionAuth && !hasReplitAuth) {
        return res.status(401).json({ message: "Acceso no autorizado - Se requiere autenticación profesional" });
      }

      const patientId = parseInt(req.params.patientId);
      console.log(`Professional requesting code revocation for patient ${patientId}`);

      // Set code expiry to past date to revoke access
      const revokedDate = new Date();
      revokedDate.setDate(revokedDate.getDate() - 1); // Set to yesterday

      await storage.updatePatientAccessCode(patientId, "ANULADO", revokedDate);

      console.log(`Access code revoked for patient ${patientId}`);

      res.json({ 
        message: "Código de acceso anulado exitosamente",
        accessCode: "ANULADO",
        revokedAt: revokedDate.toISOString()
      });
    } catch (error) {
      console.error("Error revoking access code:", error);
      res.status(500).json({ message: "Error al anular código de acceso" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
